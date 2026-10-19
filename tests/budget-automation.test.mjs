import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("budget automation is isolated to DIZZ 1 USD and starts fail-closed", async () => {
  const sql = await read("supabase/migrations/20261019120952_add_secure_budget_automation.sql");
  assert.match(sql, /account_id = '2948780535467215'/);
  assert.match(sql, /execution_enabled boolean not null default false/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all .* from anon/s);
});

test("worker freezes the target, verifies Meta and never receives financial tables", async () => {
  const worker = await read("supabase/functions/campaign-scheduler/handler.mjs");
  assert.match(worker, /resolved_budget_cents/);
  assert.match(worker, /META_VERIFICATION_MISMATCH/);
  assert.match(worker, /execution_enabled=eq\.true/);
  assert.doesNotMatch(worker, /msgs_results|push_daily_results|\bdays\b/);
});

test("public dashboard links to a protected automation page without embedding private credentials", async () => {
  const [dashboard, automation] = await Promise.all([read("docs/index.html"), read("docs/automation.html")]);
  assert.match(dashboard, /href="\.\/automation\.html"/);
  assert.match(automation, /A área de automação não aceita acesso anônimo/);
  assert.match(automation, /America\/Sao_Paulo/);
  assert.doesNotMatch(automation, /service_role|META_ACCESS_TOKEN|AUTOMATION_CRON_SECRET/);
});
