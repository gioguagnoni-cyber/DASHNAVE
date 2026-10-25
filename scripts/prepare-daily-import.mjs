import fs from "node:fs";
import path from "node:path";
import {
  buildAtomicSql,parseGamReport,parseMetaCsvReport,parseMetaSnapshot,
  prepareDailyRows,sha256File,sha256Text,
} from "./lib/daily-import.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value,index,list) => value.startsWith("--") ? [value.slice(2),!list[index+1] || list[index+1].startsWith("--") ? "true" : list[index+1]] : null).filter(Boolean));
if (args.help === "true") {
  console.log(`Uso:
  node scripts/prepare-daily-import.mjs \\
    --gam <relatorio-gam.csv> \\
    (--meta <relatorio-meta.csv> | --meta-snapshot <snapshot.json> | --meta-snapshots <a.json,b.json>) \\
    --account-id <id-do-agrupador-dashboard> \\
    --date <AAAA-MM-DD> \\
    --badge <parcial|final> \\
    --out-dir <pasta-de-saida>

Opção complementar:
  --source-meta-account-id <id>  Conta Meta física de um relatório CSV.
  --meta-currency <BRL|USD|EUR>   Informa a moeda quando o CSV Meta não a declara.`);
  process.exit(0);
}
const required = ["gam","account-id","date","badge","out-dir"];
for (const key of required) if (!args[key]) throw new Error(`Argumento obrigatório: --${key}`);
const metaOptions = [args.meta,args["meta-snapshot"],args["meta-snapshots"]].filter(Boolean);
if (!metaOptions.length) throw new Error("Use --meta <csv>, --meta-snapshot <json> ou --meta-snapshots <a.json,b.json>.");
if (metaOptions.length > 1) throw new Error("Escolha somente um modo de fonte Meta.");
if (!new Set(["parcial","final"]).has(args.badge)) throw new Error("--badge deve ser parcial ou final.");

const supabaseUrl = process.env.SUPABASE_URL || "https://akffepitbqqqgldxvtlf.supabase.co";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_yEPQth9v7-mNr0tPavuQyw_yv9IkJbk";

async function fetchAll(resource) {
  const rows = [];
  for (let offset=0;;offset+=500) {
    const separator = resource.includes("?") ? "&" : "?";
    const response = await fetch(`${supabaseUrl}/rest/v1/${resource}${separator}limit=500&offset=${offset}`,{headers:{apikey:publishableKey,Authorization:`Bearer ${publishableKey}`}});
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

const [accounts,campaigns,days,metaSources] = await Promise.all([
  fetchAll("dashboard_accounts?select=*&order=display_name.asc"),
  fetchAll(`campaigns?select=*&account_id=eq.${encodeURIComponent(args["account-id"])}&typ=eq.msgs&order=camp_n.asc`),
  fetchAll("days?select=di,date,account_id&order=di.asc"),
  fetchAll(`meta_source_accounts?select=*&dashboard_account_id=eq.${encodeURIComponent(args["account-id"])}&order=source_name.asc`),
]);
const account = accounts.find(row => row.meta_account_id === args["account-id"]);
if (!account) throw new Error(`Conta ${args["account-id"]} não encontrada ou desabilitada.`);

const gamPath = path.resolve(args.gam);
const gam = parseGamReport(fs.readFileSync(gamPath,"utf8"));
let metas;
let sourceMode;
let metaPaths;
if (args.meta) {
  const metaPath = path.resolve(args.meta);
  metaPaths = [metaPath];
  if (path.extname(metaPath).toLowerCase() !== ".csv") throw new Error("Relatório Meta deve ser CSV; para XLSX, normalize para JSON e use --meta-snapshot.");
  const sourceAccountId = args["source-meta-account-id"] || args["account-id"];
  metas = [parseMetaCsvReport(fs.readFileSync(metaPath,"utf8"),{
    account_id:sourceAccountId,currency:args["meta-currency"] || account.currency,reporting_date:args.date,
  })];
  sourceMode = "meta_file";
} else {
  metaPaths = String(args["meta-snapshots"] || args["meta-snapshot"])
    .split(",").map(value => path.resolve(value.trim())).filter(Boolean);
  metas = metaPaths.map(metaPath => parseMetaSnapshot(fs.readFileSync(metaPath,"utf8")));
  sourceMode = "meta_connector_snapshot";
}

const prepared = prepareDailyRows({account,campaigns,days,metaSources,reportingDate:args.date,badge:args.badge,gam,metas});
const provenance = {
  source_mode:sourceMode,
  meta_source_name:metaPaths.map(metaPath => path.basename(metaPath)).join(", "),
  meta_source_account_ids:metas.map(meta => meta.account_id),
  gam_source_name:path.basename(gamPath),
  meta_sha256:sha256Text(metaPaths.map(metaPath => sha256File(metaPath)).join(":")),
  gam_sha256:sha256File(gamPath),
};
const outputDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(path.join(outputDir,"prepared-rows.json"),`${JSON.stringify(prepared.rows,null,2)}\n`);
fs.writeFileSync(path.join(outputDir,"audit-summary.json"),`${JSON.stringify({
  account:{id:account.meta_account_id,name:account.display_name,currency:account.currency,timezone:account.timezone},
  date:args.date,badge:args.badge,di:prepared.di,totals:prepared.totals,
  rows:prepared.rows.length,excluded_meta:prepared.excludedMeta,
  meta_source_accounts:prepared.metaSourceIds,provenance,
},null,2)}\n`);
fs.writeFileSync(path.join(outputDir,"atomic-import.sql"),`${buildAtomicSql(prepared,provenance)}\n`);
console.log(JSON.stringify({output_dir:outputDir,account:account.display_name,date:args.date,di:prepared.di,rows:prepared.rows.length,totals:prepared.totals,excluded_meta:prepared.excludedMeta},null,2));
