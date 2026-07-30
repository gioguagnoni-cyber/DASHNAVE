import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardUrl = new URL("../docs/index.html", import.meta.url);

async function dashboardSource() {
  return readFile(dashboardUrl, "utf8");
}

test("the GitHub Pages dashboard is the single executable frontend", async () => {
  const source = await dashboardSource();
  assert.match(source, /<title>DASHFULL · Performance diária<\/title>/);
  assert.match(source, /const DAILY_FIELDS/);
  assert.match(source, /v_daily\?typ=eq\.msgs/);
  assert.doesNotMatch(source, /react|next\.js|vinext/i);
});

test("core metrics load independently from advanced insights", async () => {
  const source = await dashboardSource();
  assert.match(source, /const rpc =/);
  assert.match(source, /async function enrichDashboard/);
  assert.match(source, /void enrichDashboard\(first,last,requestId\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /campaign_ranking/);
  assert.match(source, /operational_alerts/);
  assert.match(source, /data_quality_status/);
  assert.match(source, /insightsUnavailable/);
});

test("filters, quality and campaign details preserve the dashboard safeguards", async () => {
  const source = await dashboardSource();
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "inline dashboard script must exist");
  assert.doesNotThrow(() => new Function(script));
  assert.match(source, /suffix,niche/);
  assert.match(source, /syncHash/);
  assert.match(source, /Qualidade dos dados/);
  assert.match(source, /3 dias negativos/);
  assert.match(source, /event\.key==="Escape"/);
});

test("the action panel reserves space for impact without overlapping campaign names", async () => {
  const source = await dashboardSource();
  assert.match(source, /\.alert \{[^}]*grid-template-columns:max-content minmax\(0,1fr\) 58px/);
  assert.match(source, /\.alert > span:nth-child\(2\) \{ min-width:0; \}/);
  assert.match(source, /\.alert-title \{ display:block; overflow-wrap:anywhere/);
  assert.match(source, /\.impact \{ width:58px;/);
});
