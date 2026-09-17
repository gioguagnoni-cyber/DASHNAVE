import fs from "node:fs";
import path from "node:path";
import {
  buildPushAtomicSql,parsePushGamReport,sha256File,
} from "./lib/daily-import.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value,index,list) =>
  value.startsWith("--")
    ? [value.slice(2),!list[index+1] || list[index+1].startsWith("--") ? "true" : list[index+1]]
    : null
).filter(Boolean));

if (args.help === "true") {
  console.log(`Uso:
  node scripts/prepare-push-import.mjs \\
    --push <relatorio-gam-push.csv> \\
    --account-id <id-da-conta> \\
    --date <AAAA-MM-DD> \\
    --badge <parcial|final> \\
    --out-dir <pasta-de-saida>`);
  process.exit(0);
}

for (const key of ["push","account-id","date","badge","out-dir"]) {
  if (!args[key]) throw new Error(`Argumento obrigatório: --${key}`);
}
if (!new Set(["parcial","final"]).has(args.badge)) throw new Error("--badge deve ser parcial ou final.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date deve usar AAAA-MM-DD.");

const supabaseUrl = process.env.SUPABASE_URL || "https://akffepitbqqqgldxvtlf.supabase.co";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_yEPQth9v7-mNr0tPavuQyw_yv9IkJbk";

async function fetchAll(resource) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${resource}`, {
    headers:{ apikey:publishableKey,Authorization:`Bearer ${publishableKey}` }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
}

function generatedAtIso(value) {
  const months = {
    janeiro:"01",fevereiro:"02",março:"03",abril:"04",maio:"05",junho:"06",
    julho:"07",agosto:"08",setembro:"09",outubro:"10",novembro:"11",dezembro:"12"
  };
  const match = String(value).toLocaleLowerCase("pt-BR").match(
    /([a-zç]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(am|pm)\s+brt/
  );
  if (!match || !months[match[1]]) throw new Error("Horário de geração BRT não reconhecido no relatório Push.");
  let hour = Number(match[4]);
  if (match[7] === "pm" && hour !== 12) hour += 12;
  if (match[7] === "am" && hour === 12) hour = 0;
  return `${match[3]}-${months[match[1]]}-${String(match[2]).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${match[5]}:${match[6]}-03:00`;
}

const sourcePath = path.resolve(args.push);
const report = parsePushGamReport(fs.readFileSync(sourcePath,"utf8"));
const accounts = await fetchAll("dashboard_accounts?select=*&meta_account_id=eq." + encodeURIComponent(args["account-id"]));
const account = accounts[0];
if (!account) throw new Error(`Conta ${args["account-id"]} não encontrada ou desabilitada.`);

const provenance = {
  source_name:path.basename(sourcePath),
  source_sha256:sha256File(sourcePath),
  generated_at_iso:generatedAtIso(report.generatedAt),
};
const prepared = buildPushAtomicSql({
  account,
  reportingDate:args.date,
  badge:args.badge,
  report,
  provenance
});

const outputDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(path.join(outputDir,"prepared-push-rows.json"),`${JSON.stringify(report.campaigns,null,2)}\n`);
fs.writeFileSync(path.join(outputDir,"audit-summary.json"),`${JSON.stringify({
  account:{id:account.meta_account_id,name:account.display_name,currency:account.currency},
  date:args.date,badge:args.badge,report_id:report.reportId,
  report_timezone:report.timezone,totals:prepared.totals,audit:prepared.audit,provenance
},null,2)}\n`);
fs.writeFileSync(path.join(outputDir,"atomic-push-import.sql"),`${prepared.sql}\n`);
console.log(JSON.stringify({
  output_dir:outputDir,account:account.display_name,date:args.date,
  badge:args.badge,totals:prepared.totals,audit:prepared.audit
},null,2));
