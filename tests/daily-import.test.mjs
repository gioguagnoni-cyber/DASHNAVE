import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAtomicSql,buildFinancialRow,campaignSuffix,parseGamReport,
  parseLocalizedNumber,parseMetaCsvReport,parseMetaSnapshot,prepareDailyRows,
} from "../scripts/lib/daily-import.mjs";

const brlAccount = {
  meta_account_id:"1417197509632503",display_name:"DIZZ 1 WAVE · BRL",
  currency:"BRL",timezone:"America/Sao_Paulo",tax_rate:0.13,rev_share_rate:0.10,
};
const usdAccount = {
  meta_account_id:"2948780535467215",display_name:"DIZZ 1 USD · USD",
  currency:"USD",timezone:"America/Los_Angeles",tax_rate:0.13,rev_share_rate:0.10,
};

test("localized Meta currency values are normalized without mixing separators", () => {
  assert.equal(parseLocalizedNumber("R$ 1.234,56"),1234.56);
  assert.equal(parseLocalizedNumber("US$1,234.56 USD"),1234.56);
  assert.equal(parseLocalizedNumber("US$3,31 USD"),3.31);
  assert.equal(campaignSuffix("01-RELAC-ES-URUGUAI-66830-V3 — Cópia"),"66830");
});

test("GAM parser preserves cap and broad revenue separately", () => {
  const report = [
    'Moeda do relatório,USD',
    'Período,"ago. 19, 2026"',
    'Gerado em data/hora,"ago. 20, 2026"',
    'Chaves-valor,Impressões,a,b,c,Receita',
    'utm_source=facecap_66830,100,0,0,0,10.25',
    'utm_source=facebroad_66830,50,0,0,0,2.75',
  ].join("\n");
  const parsed = parseGamReport(report);
  assert.equal(parsed.currency,"USD");
  assert.deepEqual(parsed.bySuffix.get("66830"),{
    suffix:"66830",cap_rev_cents:1025,broad_rev_cents:275,cap_imp:100,broad_imp:50,
  });
});

test("Meta CSV accepts an explicit account ID and reads the currency from the spend column", () => {
  const report = [
    'Nome da campanha,ID da campanha,Valor gasto (USD),Impressões,Início dos relatórios,Encerramento dos relatórios',
    '01-RELAC-ES-URUGUAI-66830,120252469693900652,10.76,5233,2026-08-19,2026-08-19',
  ].join("\n");
  const parsed = parseMetaCsvReport(report,{account_id:usdAccount.meta_account_id,reporting_date:"2026-08-19"});
  assert.equal(parsed.currency,"USD");
  assert.equal(parsed.account_id,usdAccount.meta_account_id);
  assert.equal(parsed.campaigns[0].spend_cents,1076);
});

test("financial rules are applied in integer cents using account configuration", () => {
  const row = buildFinancialRow({
    di:54,owner:{camp_n:104},suffix:"66830",
    meta:{spend_cents:1076,impressions:5233},
    gam:{cap_rev_cents:2000,broad_rev_cents:500,cap_imp:1000,broad_imp:500},
    taxRate:0.13,revShareRate:0.10,residual:false,
  });
  assert.equal(row.tax,1.40);
  assert.equal(row.cost,12.16);
  assert.equal(row.rev,25);
  assert.equal(row.rev_adj,22.5);
  assert.equal(row.profit,10.34);
  assert.equal(row.roi,85.03);
  assert.equal(row.cap_rev+row.broad_rev,row.rev);
});

test("same suffix in BRL and USD stays isolated by account", () => {
  const campaigns = [{
    camp_n:104,label:"01-RELAC-ES-URUGUAI-66830",suffix:"66830",meta_camp_id:"120252469693900652",
    ativo_desde:"2026-08-19",ativo_ate:null,grupo_operacao:"URUGUAI",account_id:usdAccount.meta_account_id,
  }];
  const gam = parseGamReport([
    'Moeda do relatório,USD','Período,"ago. 19, 2026"','Chaves-valor,Impressões,a,b,c,Receita',
    'utm_source=facecap_66830,100,0,0,0,20.00',
  ].join("\n"));
  const meta = parseMetaSnapshot({
    account_id:usdAccount.meta_account_id,currency:"USD",reporting_date:"2026-08-19",account_total_spend:10.76,
    campaigns:[{id:"120252469693900652",name:"01-RELAC-ES-URUGUAI-66830",effective_status:"ACTIVE",objective:"OUTCOME_SALES",spend:10.76,impressions:5233}],
  });
  const prepared = prepareDailyRows({account:usdAccount,campaigns,days:[{di:53,date:"2026-08-18",account_id:brlAccount.meta_account_id}],reportingDate:"2026-08-19",badge:"final",gam,meta});
  assert.equal(prepared.di,54);
  assert.equal(prepared.rows.length,1);
  assert.equal(prepared.rows[0].carro_n,104);
  const sql = buildAtomicSql(prepared,{source_mode:"meta_connector_snapshot",meta_source_name:"meta.json",gam_source_name:"gam.csv",meta_sha256:"a",gam_sha256:"b"});
  assert.match(sql,/2948780535467215/);
  assert.match(sql,/on conflict \(account_id,date\)/);
});

test("awareness spend is audited but excluded from the messages dashboard", () => {
  const campaigns = [{
    camp_n:104,label:"01-RELAC-ES-URUGUAI-66830",suffix:"66830",meta_camp_id:"120252469693900652",
    ativo_desde:"2026-08-19",ativo_ate:null,grupo_operacao:"URUGUAI",account_id:usdAccount.meta_account_id,
  }];
  const gam = parseGamReport(['Moeda do relatório,USD','Período,"ago. 19, 2026"','Chaves-valor,Impressões,a,b,c,Receita','utm_source=facecap_66830,10,0,0,0,2.00'].join("\n"));
  const meta = parseMetaSnapshot({
    account_id:usdAccount.meta_account_id,currency:"USD",reporting_date:"2026-08-19",account_total_spend:14.36,
    campaigns:[
      {id:"120252469693900652",name:"01-RELAC-ES-URUGUAI-66830",objective:"OUTCOME_SALES",spend:10.76},
      {id:"120252426002380652",name:"reconhecimento",objective:"OUTCOME_AWARENESS",spend:3.60},
    ],
  });
  const prepared = prepareDailyRows({account:usdAccount,campaigns,days:[],reportingDate:"2026-08-19",badge:"final",gam,meta});
  assert.equal(prepared.totals.spend,10.76);
  assert.deepEqual(prepared.excludedMeta.map(row => row.name),["reconhecimento"]);
});

test("currency mismatches and unknown message campaigns are blocked", () => {
  const gam = parseGamReport(['Moeda do relatório,BRL','Período,"ago. 19, 2026"','Chaves-valor,Impressões,a,b,c,Receita','utm_source=facecap_99999,1,0,0,0,1.00'].join("\n"));
  const meta = parseMetaSnapshot({account_id:usdAccount.meta_account_id,currency:"USD",reporting_date:"2026-08-19",campaigns:[]});
  assert.throws(() => prepareDailyRows({account:usdAccount,campaigns:[],days:[],reportingDate:"2026-08-19",badge:"final",gam,meta}),/Moeda GAM/);
});
