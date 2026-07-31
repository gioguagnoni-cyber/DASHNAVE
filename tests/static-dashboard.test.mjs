import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardUrl = new URL("../docs/index.html", import.meta.url);

async function dashboardSource() {
  return readFile(dashboardUrl, "utf8");
}

async function dashboardHelpers() {
  const source = await dashboardSource();
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "inline dashboard script must exist");
  const stoppedScript = script.replace(/\n\s*start\(\);\s*$/, "");
  const fakeDocument = { getElementById: () => ({}) };
  const fakeWindow = { addEventListener: () => {}, scrollY: 0 };
  const fakeLocation = { hash:"", pathname:"/DASHNAVE/", search:"" };
  const fakeHistory = { replaceState: () => {} };
  return new Function("document", "window", "location", "history", `${stoppedScript}\nreturn { state, setHistoryIndex, modalWindow, rollingDays, roiForDays };`)(fakeDocument, fakeWindow, fakeLocation, fakeHistory);
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
  assert.match(source, /void enrichDashboard\(first, last, requestId\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /campaign_ranking/);
  assert.match(source, /operational_alerts/);
  assert.match(source, /data_quality_status/);
  assert.match(source, /insightsUnavailable/);
});

test("quick panel filters retain only 3, 7 and 30 days", async () => {
  const source = await dashboardSource();
  assert.match(source, /const RANGE_VALUES = new Set\(\[3,7,30\]\)/);
  assert.match(source, /const QUICK_RANGES = \[3,7,30\]/);
  assert.doesNotMatch(source, /\[3,5,7,14,30\]/);
  assert.match(source, /range:RANGE_VALUES\.has\(range\) \? range : 7/);
});

test("left history, alerts and ranking share the campaign detail modal", async () => {
  const source = await dashboardSource();
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "inline dashboard script must exist");
  assert.doesNotThrow(() => new Function(script));
  assert.match(source, /data-history-campaign/);
  assert.match(source, /data-campaign/);
  assert.match(source, /openCampaignModal\(Number\(button\.dataset\.historyCampaign\), button\)/);
  assert.match(source, /openCampaignModal\(Number\(row\.dataset\.campaign\), row\)/);
  assert.match(source, /function renderCampaignModal/);
  assert.doesNotMatch(source, /function campaignDetails/);
  assert.doesNotMatch(source, /expandedCampaign/);
  assert.doesNotMatch(source, /data-open-history/);
});

test("campaign modal owns its filters, chart and non-duplicative comparisons", async () => {
  const source = await dashboardSource();
  assert.match(source, /\{ id:"panel", label:"Período do painel" \}/);
  assert.match(source, /\{ id:"14", label:"14 dias" \}/);
  assert.match(source, /\{ id:"complete", label:"Histórico completo" \}/);
  assert.match(source, /data-modal-scope/);
  assert.match(source, /function modalWindow/);
  assert.match(source, /function comparisonMarkup/);
  assert.match(source, /if \(!daysEqual\(selectedWindow\.expectedDays, lastSeven\)\)/);
  assert.match(source, /<h3>Evolução diária<\/h3>/);
  assert.match(source, /chart\(selected\.rows, `Evolução diária de/);
  assert.doesNotMatch(source, /compare\("Dia"/);
});

test("modal date windows are calculated from the end of the active panel", async () => {
  const { state, setHistoryIndex, modalWindow, rollingDays, roiForDays } = await dashboardHelpers();
  state.days = [
    { di:10, date:"2026-07-10" },
    { di:11, date:"2026-07-11" },
    { di:12, date:"2026-07-12" },
    { di:13, date:"2026-07-13" }
  ];
  state.range = 3;
  state.start = "";
  state.end = "";
  state.historyLoaded = true;
  state.history = [
    { di:10, date:"2026-07-10", campaign_id:9, label:"Campanha teste", spend:10, cost:10, rev_adj:14, profit:4 },
    { di:12, date:"2026-07-12", campaign_id:9, label:"Campanha teste", spend:20, cost:20, rev_adj:18, profit:-2 },
    { di:13, date:"2026-07-13", campaign_id:9, label:"Campanha teste", spend:30, cost:30, rev_adj:39, profit:9 }
  ];
  setHistoryIndex(state.history);

  const panel = modalWindow(9, "panel");
  const lastFourteen = modalWindow(9, "14");
  const complete = modalWindow(9, "complete");

  assert.deepEqual(panel.expectedDays.map(day => day.di), [11, 12, 13]);
  assert.deepEqual(panel.rows.map(row => row.di), [12, 13]);
  assert.deepEqual(rollingDays(14).map(day => day.di), [10, 11, 12, 13]);
  assert.equal(lastFourteen.range, "10/07/26 → 13/07/26");
  assert.deepEqual(complete.rows.map(row => row.di), [10, 12, 13]);
  assert.equal(roiForDays(complete.rows, panel.expectedDays).coverage, 2);
});

test("opening and closing a campaign preserves the dashboard scroll position", async () => {
  const source = await dashboardSource();
  assert.match(source, /scrollTop:window\.scrollY/);
  assert.match(source, /render\(\{ preserveScroll:true \}\)/);
  assert.match(source, /window\.scrollTo\(\{ top:scrollTop, behavior:"auto" \}\)/);
  assert.match(source, /modal\.opener\?\.focus\?\.\(\{ preventScroll:true \}\)/);
  assert.match(source, /\.modal-close"\)\?\.focus\(\{ preventScroll:true \}\)/);
});

test("history is grouped by real calendar month and negative streak alerts stay concise", async () => {
  const source = await dashboardSource();
  assert.match(source, /const monthLabel/);
  assert.match(source, /data-history-month/);
  assert.match(source, /expandedMonth/);
  assert.match(source, /Campanhas por mês/);
  assert.doesNotMatch(source, /Dia \$\{day\.di\+1\}/);
  assert.match(source, /detalhe:"ROI negativo, três dias consecutivos\."/);
  assert.doesNotMatch(source, /últimos 3:/);
  assert.match(source, /\.alert:has\(\.tag\.alerta\)/);
});

test("the action panel reserves space for impact without overlapping campaign names", async () => {
  const source = await dashboardSource();
  assert.match(source, /\.alert \{[\s\S]*?grid-template-columns:max-content minmax\(0,1fr\) 58px/);
  assert.match(source, /\.alert > span:nth-child\(2\) \{ min-width:0; \}/);
  assert.match(source, /\.alert-title \{ display:block; overflow-wrap:anywhere/);
  assert.match(source, /\.impact \{ width:58px;/);
});
