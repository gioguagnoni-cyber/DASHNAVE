import crypto from "node:crypto";
import fs from "node:fs";

export function roundHalfUp(value, decimals = 2) {
  const factor = 10 ** decimals;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(Number(value)) * factor + 0.5 + 1e-9) / factor;
}

export function parseLocalizedNumber(value) {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const negative = /^\s*-/.test(raw) || /^\s*\(/.test(raw);
  let cleaned = raw.replace(/[^\d.,-]/g, "").replace(/-/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let decimal = "";
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) decimal = cleaned.length - lastComma - 1 <= 2 ? "," : "";
  else if (lastDot >= 0) decimal = cleaned.length - lastDot - 1 <= 2 ? "." : "";
  if (decimal) {
    const index = cleaned.lastIndexOf(decimal);
    cleaned = `${cleaned.slice(0, index).replace(/[.,]/g, "")}.${cleaned.slice(index + 1).replace(/[.,]/g, "")}`;
  } else {
    cleaned = cleaned.replace(/[.,]/g, "");
  }
  const parsed = Number.parseFloat(cleaned || "0");
  return negative ? -parsed : parsed;
}

export function toCents(value) {
  return Math.round(roundHalfUp(parseLocalizedNumber(value), 2) * 100);
}

export function fromCents(value) {
  return Number((Number(value) / 100).toFixed(2));
}

function rateFraction(rate) {
  const text = Number(rate).toFixed(6);
  const numerator = Number(text.replace(".", ""));
  return { numerator, denominator: 1_000_000 };
}

export function applyRateCents(cents, rate) {
  const { numerator, denominator } = rateFraction(rate);
  return Math.floor((Math.abs(cents) * numerator) / denominator + 0.5) * Math.sign(cents || 1);
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === ";" || char === "\t") && !quoted) {
      const delimiter = char;
      const firstLine = input.slice(0, input.search(/\r?\n|$/));
      const expected = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
      if (delimiter === expected) {
        row.push(field);
        field = "";
      } else {
        field += char;
      }
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
  }
  return rows;
}

export function campaignSuffix(value) {
  const cleaned = String(value ?? "")
    .replace(/[-–—\s]+V\d+\b/gi, "")
    .replace(/[-–—\s]+C[ÓO]PIA\b/gi, "");
  return cleaned.replace(/\D+/g, "").slice(-5);
}

export function normalizeCampaignBase(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[-–—\s]+V\d+\b/gi, "")
    .replace(/[-–—\s]+COPIA\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function metadataValue(rows, label) {
  return rows.find(row => String(row[0] ?? "").trim().toLowerCase() === label.toLowerCase())?.[1] ?? null;
}

export function parseGamReport(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex(row => String(row[0] ?? "").trim() === "Chaves-valor");
  if (headerIndex < 0) throw new Error("Cabeçalho 'Chaves-valor' não encontrado no relatório GAM.");
  const currency = String(metadataValue(rows, "Moeda do relatório") ?? "").trim().toUpperCase();
  const period = String(metadataValue(rows, "Período") ?? "").trim();
  const generatedAt = String(metadataValue(rows, "Gerado em data/hora") ?? "").trim();
  if (!currency) throw new Error("Moeda do relatório GAM não encontrada.");

  const bySuffix = new Map();
  let sourceRows = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const key = String(row[0] ?? "").trim();
    if (!/^utm_source=face(?:cap|broad)_/i.test(key)) continue;
    sourceRows += 1;
    const suffix = campaignSuffix(key);
    const current = bySuffix.get(suffix) ?? { suffix, cap_rev_cents:0, broad_rev_cents:0, cap_imp:0, broad_imp:0 };
    const impressions = Math.trunc(parseLocalizedNumber(row[1] ?? 0));
    const revenueCents = toCents(row[5] ?? 0);
    if (/^utm_source=facecap_/i.test(key)) {
      current.cap_rev_cents += revenueCents;
      current.cap_imp += impressions;
    } else {
      current.broad_rev_cents += revenueCents;
      current.broad_imp += impressions;
    }
    bySuffix.set(suffix, current);
  }
  return { currency, period, generatedAt, sourceRows, bySuffix };
}

const META_HEADERS = {
  id:["ID da campanha","Campaign ID","Identificação da campanha"],
  name:["Nome da campanha","Campaign name"],
  spend:["Valor gasto (BRL)","Valor gasto (USD)","Amount spent","Amount spent (USD)","Amount spent (BRL)"],
  impressions:["Impressões","Impressions"],
  start:["Início dos relatórios","Reporting starts"],
  end:["Encerramento dos relatórios","Reporting ends"],
  status:["Veiculação da campanha","Campaign delivery","Status da campanha","Campaign status"],
  currency:["Moeda","Currency"],
  accountId:["ID da conta","Account ID","Ad account ID"],
  accountName:["Nome da conta","Account name","Ad account name"],
};

function headerIndex(header, candidates) {
  const normalized = header.map(value => String(value ?? "").trim().toLowerCase());
  return candidates.map(value => normalized.indexOf(value.toLowerCase())).find(index => index >= 0) ?? -1;
}

function currencyFromSpendHeader(header) {
  const match = header.map(String).join(" ").match(/Valor gasto \(([A-Z]{3})\)|Amount spent \(([A-Z]{3})\)/i);
  return String(match?.[1] || match?.[2] || "").toUpperCase();
}

export function parseMetaCsvReport(text, explicit = {}) {
  const rows = parseCsv(text);
  const headerRow = rows.findIndex(row => headerIndex(row, META_HEADERS.name) >= 0 && headerIndex(row, META_HEADERS.spend) >= 0);
  if (headerRow < 0) throw new Error("Cabeçalho de campanha/gasto não encontrado no relatório Meta Ads.");
  const header = rows[headerRow];
  const indexes = Object.fromEntries(Object.entries(META_HEADERS).map(([key, candidates]) => [key, headerIndex(header, candidates)]));
  const campaignRows = rows.slice(headerRow + 1).filter(row => indexes.name >= 0 && String(row[indexes.name] ?? "").trim()).map(row => ({
    id:indexes.id >= 0 ? String(row[indexes.id] ?? "").trim() : "",
    name:String(row[indexes.name] ?? "").trim(),
    spend_cents:toCents(row[indexes.spend] ?? 0),
    impressions:indexes.impressions >= 0 ? Math.trunc(parseLocalizedNumber(row[indexes.impressions] ?? 0)) : 0,
    start:indexes.start >= 0 ? String(row[indexes.start] ?? "").trim() : "",
    end:indexes.end >= 0 ? String(row[indexes.end] ?? "").trim() : "",
    effective_status:indexes.status >= 0 ? String(row[indexes.status] ?? "").trim().toUpperCase() : "",
    suffix:campaignSuffix(row[indexes.name]),
  }));
  const firstData = rows[headerRow + 1] ?? [];
  return {
    account_id:String(explicit.account_id || (indexes.accountId >= 0 ? firstData[indexes.accountId] : "") || ""),
    account_name:String(explicit.account_name || (indexes.accountName >= 0 ? firstData[indexes.accountName] : "") || ""),
    currency:String(explicit.currency || (indexes.currency >= 0 ? firstData[indexes.currency] : "") || currencyFromSpendHeader(header) || "").toUpperCase(),
    reporting_date:String(explicit.reporting_date || ""),
    campaigns:campaignRows,
    account_total_spend_cents:campaignRows.reduce((sum,row) => sum + row.spend_cents,0),
  };
}

export function parseMetaSnapshot(value) {
  const snapshot = typeof value === "string" ? JSON.parse(value) : value;
  if (!snapshot || !Array.isArray(snapshot.campaigns)) throw new Error("Snapshot Meta inválido: campaigns deve ser uma lista.");
  const campaigns = snapshot.campaigns.map(row => ({
    id:String(row.id ?? row.campaign_id ?? ""),
    name:String(row.name ?? row.campaign_name ?? "").trim(),
    spend_cents:toCents(row.spend ?? row.amount_spent ?? 0),
    impressions:Math.trunc(parseLocalizedNumber(row.impressions ?? 0)),
    effective_status:String(row.effective_status ?? row.status ?? "").toUpperCase(),
    objective:String(row.objective ?? "").toUpperCase(),
    suffix:campaignSuffix(row.name ?? row.campaign_name),
  }));
  return {
    account_id:String(snapshot.account_id ?? ""),
    account_name:String(snapshot.account_name ?? ""),
    currency:String(snapshot.currency ?? "").toUpperCase(),
    reporting_date:String(snapshot.reporting_date ?? snapshot.date ?? ""),
    campaigns,
    account_total_spend_cents:toCents(snapshot.account_total_spend ?? fromCents(campaigns.reduce((sum,row) => sum + row.spend_cents,0))),
  };
}

function activeOn(campaign, date) {
  return Boolean(campaign.ativo_desde) && date >= campaign.ativo_desde && (!campaign.ativo_ate || date <= campaign.ativo_ate);
}

export function resolveOwner(campaigns, suffix, date) {
  const matching = campaigns.filter(campaign => campaign.suffix === suffix);
  const active = matching.filter(campaign => activeOn(campaign, date));
  const groups = new Set(active.map(campaign => campaign.grupo_operacao || campaign.label));
  if (groups.size > 1) throw new Error(`Conflito: mais de uma operação ativa usa o sufixo ${suffix} em ${date}.`);
  if (active.length) {
    return [...active].sort((left,right) => {
      const leftOpen = left.ativo_ate ? 0 : 1;
      const rightOpen = right.ativo_ate ? 0 : 1;
      return rightOpen-leftOpen || left.ativo_desde.localeCompare(right.ativo_desde) || left.camp_n-right.camp_n;
    })[0];
  }
  return matching.filter(campaign => campaign.ativo_ate && campaign.ativo_ate < date)
    .sort((left,right) => right.ativo_ate.localeCompare(left.ativo_ate) || right.camp_n-left.camp_n)[0] ?? null;
}

export function buildFinancialRow({ di, owner, suffix, meta, gam, taxRate, revShareRate, residual }) {
  const spendCents = meta?.spend_cents ?? 0;
  const taxCents = applyRateCents(spendCents, taxRate);
  const costCents = spendCents + taxCents;
  const capCents = gam?.cap_rev_cents ?? 0;
  const broadCents = gam?.broad_rev_cents ?? 0;
  const revCents = capCents + broadCents;
  const capAdjCents = capCents - applyRateCents(capCents, revShareRate);
  const broadAdjCents = broadCents - applyRateCents(broadCents, revShareRate);
  const revAdjCents = capAdjCents + broadAdjCents;
  const profitCents = revAdjCents - costCents;
  const adxImp = (gam?.cap_imp ?? 0) + (gam?.broad_imp ?? 0);
  const roi = costCents === 0 ? null : roundHalfUp((profitCents / costCents) * 100,2);
  const rpm = adxImp === 0 ? 0 : roundHalfUp((revCents / 100 / adxImp) * 1000,2);
  return {
    di,carro_n:owner.camp_n,suffix,
    spend:fromCents(spendCents),tax:fromCents(taxCents),cost:fromCents(costCents),
    broad_rev:fromCents(broadCents),cap_rev:fromCents(capCents),rev:fromCents(revCents),
    rev_adj:fromCents(revAdjCents),broad_adj:fromCents(broadAdjCents),cap_adj:fromCents(capAdjCents),
    profit:fromCents(profitCents),roi,rpm,
    broad_imp:gam?.broad_imp ?? 0,cap_imp:gam?.cap_imp ?? 0,fb_imp:meta?.impressions ?? 0,
    novos:meta?.novos ?? 0,rpc:0,
    status:profitCents >= 0 ? "lucro" : profitCents > -1000 ? "quase" : "negativo",
    residual:Boolean(residual),
  };
}

export function prepareDailyRows({ account, campaigns, days, reportingDate, badge, gam, meta }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportingDate)) throw new Error("Data deve estar em YYYY-MM-DD.");
  if (!account) throw new Error("Conta não cadastrada.");
  if (gam.currency !== account.currency) throw new Error(`Moeda GAM ${gam.currency} diverge da conta ${account.currency}.`);
  const [year,month,day] = reportingDate.split("-");
  const monthToken = ["jan.","fev.","mar.","abr.","mai.","jun.","jul.","ago.","set.","out.","nov.","dez."][Number(month)-1];
  if (gam.period && !gam.period.includes(reportingDate) && !(gam.period.toLowerCase().includes(monthToken) && gam.period.includes(String(Number(day))) && gam.period.includes(year))) {
    throw new Error(`Período GAM '${gam.period}' diverge de ${reportingDate}.`);
  }
  if (!meta.currency) throw new Error("Moeda do Meta não informada; use --meta-currency.");
  if (meta.currency !== account.currency) throw new Error(`Moeda Meta ${meta.currency} diverge da conta ${account.currency}.`);
  if (meta.account_id && meta.account_id !== account.meta_account_id) throw new Error(`Conta Meta ${meta.account_id} diverge da conta selecionada ${account.meta_account_id}.`);
  if (meta.reporting_date && meta.reporting_date !== reportingDate) throw new Error(`Data Meta ${meta.reporting_date} diverge de ${reportingDate}.`);

  const registeredById = new Map(campaigns.filter(row => row.meta_camp_id).map(row => [String(row.meta_camp_id),row]));
  const eligibleMeta = new Map();
  const excludedMeta = [];
  const unknownMeta = [];
  let allCampaignSpendCents = 0;
  for (const row of meta.campaigns) {
    if ((row.start && row.start !== reportingDate) || (row.end && row.end !== reportingDate)) {
      throw new Error(`Período Meta da campanha ${row.name} diverge de ${reportingDate}.`);
    }
    allCampaignSpendCents += row.spend_cents;
    const registered = registeredById.get(row.id);
    if (!registered) {
      const suffixCandidates = campaigns.filter(campaign => campaign.suffix === row.suffix && activeOn(campaign,reportingDate));
      const isVariation = suffixCandidates.length && suffixCandidates.some(campaign => normalizeCampaignBase(row.name).startsWith(normalizeCampaignBase(campaign.label)) || normalizeCampaignBase(campaign.label).startsWith(normalizeCampaignBase(row.name)));
      if (isVariation) {
        // A V2/V3/V4 or copy contributes to the active owner's suffix total.
      } else if (!row.suffix || row.objective === "OUTCOME_AWARENESS") {
        excludedMeta.push({ id:row.id,name:row.name,spend:fromCents(row.spend_cents),reason:"fora do painel de mensagens" });
        continue;
      } else {
        unknownMeta.push({ id:row.id,name:row.name,suffix:row.suffix,spend:fromCents(row.spend_cents) });
        continue;
      }
    }
    const current = eligibleMeta.get(row.suffix) ?? { spend_cents:0,impressions:0,campaigns:[] };
    current.spend_cents += row.spend_cents;
    current.impressions += row.impressions;
    current.campaigns.push(row.name);
    eligibleMeta.set(row.suffix,current);
  }
  if (unknownMeta.length) throw new Error(`Campanhas Meta não cadastradas: ${unknownMeta.map(row => `${row.name} [${row.suffix}]`).join(", ")}.`);
  if (Math.abs(allCampaignSpendCents - meta.account_total_spend_cents) > 100) {
    throw new Error(`Total Meta por campanha diverge do total da conta em ${fromCents(Math.abs(allCampaignSpendCents-meta.account_total_spend_cents))} ${account.currency}.`);
  }

  const existingDay = days.find(day => day.account_id === account.meta_account_id && day.date === reportingDate);
  const di = existingDay?.di ?? Math.max(-1,...days.map(day => Number(day.di))) + 1;
  const suffixes = new Set([...eligibleMeta.keys(),...gam.bySuffix.keys()]);
  const preparedRows = [];
  const unmappedGam = [];
  for (const suffix of [...suffixes].sort()) {
    const metaValues = eligibleMeta.get(suffix) ?? { spend_cents:0,impressions:0,campaigns:[] };
    const gamValues = gam.bySuffix.get(suffix) ?? { cap_rev_cents:0,broad_rev_cents:0,cap_imp:0,broad_imp:0 };
    const hasValue = metaValues.spend_cents !== 0 || gamValues.cap_rev_cents !== 0 || gamValues.broad_rev_cents !== 0;
    if (!hasValue) continue;
    const owner = resolveOwner(campaigns,suffix,reportingDate);
    if (!owner) {
      unmappedGam.push({ suffix,rev:fromCents(gamValues.cap_rev_cents+gamValues.broad_rev_cents),spend:fromCents(metaValues.spend_cents) });
      continue;
    }
    const ownerIsActive = activeOn(owner,reportingDate);
    if (metaValues.spend_cents > 0 && !ownerIsActive) throw new Error(`Gasto do sufixo ${suffix} iria para campanha inativa.`);
    const residual = !ownerIsActive && metaValues.spend_cents === 0 && gamValues.cap_rev_cents+gamValues.broad_rev_cents > 0;
    preparedRows.push(buildFinancialRow({
      di,owner,suffix,meta:metaValues,gam:gamValues,
      taxRate:Number(account.tax_rate),revShareRate:Number(account.rev_share_rate),residual,
    }));
  }
  if (unmappedGam.some(row => row.rev !== 0 || row.spend !== 0)) {
    throw new Error(`Sufixos sem campanha cadastrada na conta: ${unmappedGam.map(row => row.suffix).join(", ")}.`);
  }

  const totals = preparedRows.reduce((acc,row) => {
    for (const key of ["spend","tax","cost","cap_rev","broad_rev","rev","rev_adj","profit"]) acc[key] = roundHalfUp(acc[key]+row[key],2);
    acc.fb_imp += row.fb_imp;
    acc.adx_imp += row.cap_imp+row.broad_imp;
    if (row.residual) acc.residual_rows += 1;
    return acc;
  },{spend:0,tax:0,cost:0,cap_rev:0,broad_rev:0,rev:0,rev_adj:0,profit:0,fb_imp:0,adx_imp:0,residual_rows:0});
  totals.roi = totals.cost === 0 ? null : roundHalfUp(totals.profit/totals.cost*100,2);
  return { account,reportingDate,badge,di,existingDay,rows:preparedRows,totals,excludedMeta };
}

function sqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return `'${String(value).replaceAll("'","''")}'`;
}

export function buildAtomicSql(prepared, provenance) {
  const { account,reportingDate,badge,di,rows,totals,excludedMeta } = prepared;
  const label = reportingDate.split("-").reverse().join("/");
  const ts = `${label} · ${badge === "parcial" ? "Parcial" : "Fechado"}`;
  const columns = ["di","carro_n","suffix","spend","tax","cost","broad_rev","cap_rev","rev","rev_adj","broad_adj","cap_adj","profit","roi","rpm","broad_imp","cap_imp","fb_imp","novos","rpc","status","residual"];
  const values = rows.map(row => `  (${columns.map(column => sqlValue(row[column])).join(",")})`).join(",\n");
  const batchKey = sha256Text(JSON.stringify({account:account.meta_account_id,reportingDate,badge,meta:provenance.meta_sha256,gam:provenance.gam_sha256}));
  const audit = { excluded_meta:excludedMeta, row_count:rows.length };
  return `begin;
do $guard$
begin
  if not exists (select 1 from public.dashboard_accounts where meta_account_id=${sqlValue(account.meta_account_id)} and currency=${sqlValue(account.currency)} and enabled) then
    raise exception 'Conta/moeda não cadastrada ou desabilitada';
  end if;
  if exists (select 1 from public.days where di=${di} and (account_id<>${sqlValue(account.meta_account_id)} or date<>date ${sqlValue(reportingDate)})) then
    raise exception 'DI ${di} já pertence a outra conta ou data';
  end if;
end
$guard$;

insert into public.days (di,label,date,badge,ts,account_id)
values (${di},${sqlValue(label)},date ${sqlValue(reportingDate)},${sqlValue(badge)},${sqlValue(ts)},${sqlValue(account.meta_account_id)})
on conflict (account_id,date) do update set
  label=excluded.label,badge=excluded.badge,ts=excluded.ts;

delete from public.msgs_results where di=${di};
${rows.length ? `insert into public.msgs_results (${columns.join(",")}) values\n${values};` : ""}

insert into private.import_batches (
  batch_key,account_id,reporting_date,source_mode,is_partial,source_currency,
  meta_source_name,gam_source_name,meta_sha256,gam_sha256,status,totals,audit,completed_at
) values (
  ${sqlValue(batchKey)},${sqlValue(account.meta_account_id)},date ${sqlValue(reportingDate)},${sqlValue(provenance.source_mode)},${badge === "parcial"},${sqlValue(account.currency)},
  ${sqlValue(provenance.meta_source_name)},${sqlValue(provenance.gam_source_name)},${sqlValue(provenance.meta_sha256)},${sqlValue(provenance.gam_sha256)},'applied',
  ${sqlValue(JSON.stringify(totals))}::jsonb,${sqlValue(JSON.stringify(audit))}::jsonb,now()
)
on conflict (batch_key) do update set
  status='applied',totals=excluded.totals,audit=excluded.audit,error_text=null,completed_at=now();
commit;`;
}
