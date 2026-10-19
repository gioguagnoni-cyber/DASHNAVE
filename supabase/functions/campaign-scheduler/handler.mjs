const ACCOUNT_ID = "2948780535467215";
const ID_PATTERN = /^[0-9]+$/;
const ORIGINS = new Set([
  "https://gioguagnoni-cyber.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

class SafeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers }
});

export function createHandler(env, { fetchImpl = fetch, clock = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  const base = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;

  function cors(req) {
    const origin = req.headers.get("origin") || "";
    return ORIGINS.has(origin) ? {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, apikey, content-type, x-cron-secret",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "origin"
    } : {};
  }

  async function db(path, { method = "GET", body, prefer } = {}) {
    if (!base || !service) throw new SafeError("SERVER_NOT_CONFIGURED", 503);
    const response = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: service,
        authorization: `Bearer ${service}`,
        "content-type": "application/json",
        ...(prefer ? { prefer } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    if (!response.ok) throw new SafeError("DATABASE_UNAVAILABLE", 503);
    return raw ? JSON.parse(raw) : null;
  }

  const rpc = (name, body) => db(`rpc/${name}`, { method: "POST", body });

  function credentials(accountId) {
    const token = env[`META_ACCESS_TOKEN_${accountId}`];
    const version = env.META_GRAPH_VERSION;
    if (!token || !/^v\d+\.\d+$/.test(version || "")) throw new SafeError("META_NOT_CONFIGURED", 503);
    return { token, version };
  }

  async function meta(accountId, path, body) {
    const { token, version } = credentials(accountId);
    const response = await fetchImpl(`https://graph.facebook.com/${version}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {})
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
      const code = Number(result.error?.code || 0);
      if (code === 190) throw new SafeError("META_AUTH_EXPIRED", 503);
      if (code === 10 || code === 200) throw new SafeError("META_PERMISSION_DENIED", 503);
      if (response.status === 429) throw new SafeError("META_RATE_LIMIT", 503);
      throw new SafeError("META_REQUEST_FAILED", 503);
    }
    return result;
  }

  async function authorize(req, accountId, roles) {
    const value = req.headers.get("authorization") || "";
    const token = value.startsWith("Bearer ") ? value.slice(7) : "";
    if (!token) throw new SafeError("AUTH_REQUIRED", 401);
    const response = await fetchImpl(`${base}/auth/v1/user`, {
      headers: { apikey: service, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });
    const user = await response.json().catch(() => ({}));
    if (!response.ok || !user.id) throw new SafeError("AUTH_INVALID", 401);
    const rows = await db(`automation_members?account_id=eq.${accountId}&user_id=eq.${user.id}&select=role`);
    if (!rows?.length || !roles.includes(rows[0].role)) throw new SafeError("AUTH_FORBIDDEN", 403);
    return user;
  }

  async function sync(accountId) {
    if (accountId !== ACCOUNT_ID) throw new SafeError("ACCOUNT_NOT_ALLOWED", 403);
    const identity = await meta(accountId, `act_${accountId}?fields=id,account_id,account_status,currency,timezone_name`);
    if (String(identity.account_id) !== accountId || Number(identity.account_status) !== 1) {
      throw new SafeError("META_ACCOUNT_UNAVAILABLE", 503);
    }
    const campaigns = [];
    const cursors = new Set();
    let after = "";
    do {
      const query = `act_${accountId}/campaigns?fields=id,account_id,name,status,effective_status,daily_budget&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const result = await meta(accountId, query);
      if (!Array.isArray(result.data)) throw new SafeError("META_INVALID_CATALOG", 503);
      for (const campaign of result.data) {
        if (!ID_PATTERN.test(String(campaign.id)) || String(campaign.account_id) !== accountId) {
          throw new SafeError("META_ACCOUNT_MISMATCH", 503);
        }
        const budget = Number(campaign.daily_budget || 0);
        campaigns.push({
          account_id: accountId,
          campaign_id: String(campaign.id),
          name: String(campaign.name || campaign.id),
          status: campaign.status || null,
          effective_status: campaign.effective_status || null,
          daily_budget_cents: Number.isSafeInteger(budget) && budget > 0 ? budget : null,
          budget_model: Number.isSafeInteger(budget) && budget > 0 ? "campaign" : "unsupported",
          seen_at: clock().toISOString()
        });
      }
      if (!result.paging?.next) break;
      after = result.paging?.cursors?.after || "";
      if (!after || cursors.has(after) || cursors.size >= 100) throw new SafeError("META_INCOMPLETE_PAGINATION", 503);
      cursors.add(after);
    } while (true);
    for (let offset = 0; offset < campaigns.length; offset += 200) {
      await db("automation_campaigns?on_conflict=account_id,campaign_id", {
        method: "POST",
        body: campaigns.slice(offset, offset + 200),
        prefer: "resolution=merge-duplicates,return=minimal"
      });
    }
    await db(`automation_accounts?account_id=eq.${accountId}`, {
      method: "PATCH",
      body: { connection_state: "ready", last_sync_at: clock().toISOString(), last_error_code: null, updated_at: clock().toISOString() }
    });
    return campaigns.length;
  }

  async function finish(schedule, leaseToken, success, values = {}) {
    return rpc("automation_finish_budget_schedule", {
      p_schedule_id: schedule.id,
      p_lease_token: leaseToken,
      p_succeeded: success,
      p_before: values.before ?? null,
      p_requested: values.requested ?? null,
      p_confirmed: values.confirmed ?? null,
      p_error_code: values.errorCode ?? null,
      p_provider_reference: values.providerReference ?? null
    });
  }

  async function executeSchedule(schedule, leaseToken) {
    let before = null;
    let requested = schedule.resolved_budget_cents ? Number(schedule.resolved_budget_cents) : null;
    try {
      if (schedule.account_id !== ACCOUNT_ID || !ID_PATTERN.test(schedule.campaign_id)) throw new SafeError("INVALID_SCHEDULE");
      const accountRows = await db(`automation_accounts?account_id=eq.${ACCOUNT_ID}&execution_enabled=eq.true&connection_state=eq.ready&select=account_id`);
      if (!accountRows?.length) throw new SafeError("AUTOMATION_DISABLED", 503);
      const campaign = await meta(ACCOUNT_ID, `${schedule.campaign_id}?fields=id,account_id,name,status,effective_status,daily_budget`);
      if (String(campaign.account_id) !== ACCOUNT_ID || String(campaign.id) !== schedule.campaign_id) throw new SafeError("META_ACCOUNT_MISMATCH", 503);
      before = Number(campaign.daily_budget || 0);
      if (!Number.isSafeInteger(before) || before < 100) throw new SafeError("UNSUPPORTED_BUDGET_MODEL");
      if (!requested) {
        requested = schedule.change_mode === "percent"
          ? Math.round(before * (1 + Number(schedule.change_percent) / 100))
          : Number(schedule.target_budget_cents);
        if (!Number.isSafeInteger(requested) || requested < 100) throw new SafeError("INVALID_TARGET_BUDGET");
        await db(`automation_budget_schedules?id=eq.${schedule.id}&lease_token=eq.${leaseToken}`, {
          method: "PATCH", body: { resolved_budget_cents: requested, base_budget_cents: before, updated_at: clock().toISOString() }
        });
      }
      let providerReference = "already_applied";
      if (before !== requested) {
        const changed = await meta(ACCOUNT_ID, schedule.campaign_id, { daily_budget: String(requested) });
        if (changed.success !== true) throw new SafeError("META_UPDATE_NOT_CONFIRMED", 503);
        providerReference = "meta_success";
      }
      const verified = await meta(ACCOUNT_ID, `${schedule.campaign_id}?fields=id,account_id,daily_budget`);
      const confirmed = Number(verified.daily_budget || 0);
      if (String(verified.account_id) !== ACCOUNT_ID || confirmed !== requested) throw new SafeError("META_VERIFICATION_MISMATCH", 503);
      await finish(schedule, leaseToken, true, { before, requested, confirmed, providerReference });
      await db(`automation_campaigns?account_id=eq.${ACCOUNT_ID}&campaign_id=eq.${schedule.campaign_id}`, {
        method: "PATCH", body: { daily_budget_cents: confirmed, seen_at: clock().toISOString() }
      });
      return { id: schedule.id, status: "succeeded", before, requested, confirmed };
    } catch (error) {
      const code = error instanceof SafeError ? error.code : "UNEXPECTED_ERROR";
      await finish(schedule, leaseToken, false, { before, requested, errorCode: code }).catch(() => null);
      return { id: schedule.id, status: "failed", error: code };
    }
  }

  async function runWorker() {
    const now = clock().toISOString();
    const enabled = await db(`automation_accounts?account_id=eq.${ACCOUNT_ID}&execution_enabled=eq.true&connection_state=eq.ready&select=account_id`);
    if (!enabled?.length) {
      await db(`automation_accounts?account_id=eq.${ACCOUNT_ID}`, {
        method: "PATCH", body: { last_worker_at: now, updated_at: now }
      });
      return [];
    }
    const [pending, abandoned] = await Promise.all([
      db(`automation_budget_schedules?status=eq.pending&execute_at=lte.${encodeURIComponent(now)}&select=*&order=execute_at.asc&limit=25`),
      db(`automation_budget_schedules?status=eq.running&lease_until=lt.${encodeURIComponent(now)}&select=*&order=execute_at.asc&limit=25`)
    ]);
    const rows = [...(pending || []), ...(abandoned || [])].slice(0, 25);
    const results = [];
    for (const row of rows) {
      const leaseToken = uuid();
      const claimed = await rpc("automation_claim_budget_schedule", { p_schedule_id: row.id, p_lease_token: leaseToken });
      const schedule = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!schedule?.id) continue;
      results.push(await executeSchedule(schedule, leaseToken));
    }
    await db(`automation_accounts?account_id=eq.${ACCOUNT_ID}`, {
      method: "PATCH", body: { last_worker_at: now, updated_at: now }
    });
    return results;
  }

  return async function handler(req) {
    const headers = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, headers);
    try {
      const body = await req.json().catch(() => ({}));
      const operation = body.operation || "health";
      const accountId = String(body.account_id || ACCOUNT_ID);
      if (accountId !== ACCOUNT_ID) throw new SafeError("ACCOUNT_NOT_ALLOWED", 403);
      if (operation === "run") {
        const supplied = req.headers.get("x-cron-secret") || "";
        const verified = supplied ? await rpc("automation_verify_cron_secret", { p_secret: supplied }) : false;
        if (verified !== true) throw new SafeError("CRON_FORBIDDEN", 403);
        return json({ ok: true, meta_configured: Boolean(env[`META_ACCESS_TOKEN_${accountId}`] && env.META_GRAPH_VERSION), results: await runWorker() }, 200, headers);
      }
      await authorize(req, accountId, operation === "health" ? ["owner", "editor", "viewer"] : ["owner", "editor"]);
      if (operation === "sync") return json({ ok: true, campaigns: await sync(accountId) }, 200, headers);
      if (operation === "health") {
        const account = await db(`automation_accounts?account_id=eq.${accountId}&select=account_id,display_name,currency,timezone,connection_state,execution_enabled,last_sync_at,last_worker_at,last_error_code`);
        const cronReady = await rpc("automation_cron_ready", {});
        return json({ ok: true, account: account?.[0] || null, meta_configured: Boolean(env[`META_ACCESS_TOKEN_${accountId}`] && env.META_GRAPH_VERSION), cron_configured: cronReady === true }, 200, headers);
      }
      throw new SafeError("UNKNOWN_OPERATION");
    } catch (error) {
      const safe = error instanceof SafeError ? error : new SafeError("UNEXPECTED_ERROR", 500);
      return json({ ok: false, error: safe.code }, safe.status, headers);
    }
  };
}
