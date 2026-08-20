import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialRow } from "../scripts/lib/daily-import.mjs";

const base = {
  di:54,
  owner:{camp_n:104},
  suffix:"66830",
  meta:{spend_cents:10000,impressions:1000},
  gam:{cap_rev_cents:15000,broad_rev_cents:5000,cap_imp:1000,broad_imp:500},
  revShareRate:0.10,
  residual:false,
};

test("BRL keeps the 13% Meta Ads tax", () => {
  const row = buildFinancialRow({ ...base, taxRate:0.13 });
  assert.equal(row.spend,100);
  assert.equal(row.tax,13);
  assert.equal(row.cost,113);
  assert.equal(row.rev_adj,180);
  assert.equal(row.profit,67);
  assert.equal(row.roi,59.29);
});

test("USD preserves original Meta Ads spend with no additional tax", () => {
  const row = buildFinancialRow({ ...base, taxRate:0 });
  assert.equal(row.spend,100);
  assert.equal(row.tax,0);
  assert.equal(row.cost,100);
  assert.equal(row.rev_adj,180);
  assert.equal(row.profit,80);
  assert.equal(row.roi,80);
});
