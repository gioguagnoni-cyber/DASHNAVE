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
  const fakeWindow = { addEventListener: () => {}, scrollY:0 };
  const fakeLocation = { hash:"", pathname:"/DASHNAVE/", search:"" };
  const fakeHistory = { replaceState: () => {} };
  return new Function(
    "document",
    "window",
    "location",
    "history",
    `${stoppedScript}
      return {
        state, calendarDays, comparisonCell, dayCampaignRows, isoShift, modalWindow,
        monthBounds, monthCoverage, monthSummary, roiForDays, roiForRow, sortRows,
        roiText, totalRoi, totals
      };`
  )(fakeDocument, fakeWindow, fakeLocation, fakeHistory);
}

test("the GitHub Pages dashboard is the single executable frontend", async () => {
  const source = await dashboardSource();
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(source, /<title>DASHFULL · Performance diária<\/title>/);
  assert.match(source, /const DAILY_FIELDS = ".*spend,tax,cost,cap_rev,broad_rev,rev,rev_adj,profit,roi/);
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

test("initial and drill-down queries are paginated and the full history is lazy", async () => {
  const source = await dashboardSource();
  assert.match(source, /const PAGE_SIZE = 500/);
  assert.match(source, /const apiAll = async path/);
  assert.match(source, /limit=\$\{PAGE_SIZE\}&offset=\$\{offset\}/);
  assert.match(source, /const daily = await apiAll\(`v_daily\?typ=eq\.msgs&di=gte\./);
  assert.match(source, /async function loadMonthData/);
  assert.match(source, /async function loadCampaignData/);
  assert.match(source, /monthCache: new Map\(\)/);
  assert.match(source, /campaignCache: new Map\(\)/);
  assert.doesNotMatch(source, /loadHistory|historyLoaded|state\.history/);
});

test("quick panel filters retain only 3, 7 and 30 days", async () => {
  const source = await dashboardSource();
  assert.match(source, /const RANGE_VALUES = new Set\(\[3,7,30\]\)/);
  assert.match(source, /const QUICK_RANGES = \[3,7,30\]/);
  assert.doesNotMatch(source, /\[3,5,7,14,30\]/);
  assert.match(source, /range:RANGE_VALUES\.has\(range\) \? range : 7/);
});

test("months open the unified modal directly instead of expanding the sidebar", async () => {
  const source = await dashboardSource();
  assert.match(source, /Campanhas por mês/);
  assert.match(source, /data-history-month="\$\{month\.key\}"/);
  assert.match(source, /openMonthModal\(button\.dataset\.historyMonth, button\)/);
  assert.match(source, /function monthModalMarkup/);
  assert.match(source, /dias"} no período/);
  assert.match(source, /com dados/);
  assert.match(source, /data-month-day/);
  assert.match(source, /function openDayFromMonth/);
  assert.doesNotMatch(source, /data-history-day|expandedMonth|expandedDay/);
});

test("monthly coverage follows the latest imported date and exposes data gaps", async () => {
  const { monthCoverage } = await dashboardHelpers();
  const days = [
    ...Array.from({ length:4 }, (_, index) => ({ date:`2026-07-${String(index + 1).padStart(2, "0")}` })),
    ...Array.from({ length:22 }, (_, index) => ({ date:`2026-07-${String(index + 8).padStart(2, "0")}` }))
  ];
  const july = monthCoverage(days);

  assert.equal(july.first, "2026-07-01");
  assert.equal(july.last, "2026-07-29");
  assert.equal(july.periodDays, 29);
  assert.equal(july.daysWithData, 26);
  assert.deepEqual(july.missing, ["2026-07-05", "2026-07-06", "2026-07-07"]);
});

test("the month table contains every requested sortable column and no status", async () => {
  const source = await dashboardSource();
  const monthMarkup = source.slice(
    source.indexOf("function monthModalMarkup"),
    source.indexOf("function dayModalMarkup")
  );
  for (const heading of [
    "Data", "Campanhas", "Gasto", "Custo", "Rec. Cap", "Rec. Broad", "Rec. Bruta", "Rec. Líq.",
    "Lucro", "ROI", "D-1", "D-2", "Últ. 7", "Últ. 14"
  ]) {
    assert.match(monthMarkup, new RegExp(`sortableHead\\("${heading.replace(".", "\\.")}"`));
  }
  assert.doesNotMatch(monthMarkup, /sortableHead\("Status"/);
  assert.match(monthMarkup, /data-month-day="\$\{row\.di\}"/);
});

test("month totals and ROI comparisons use exact calendar dates", async () => {
  const { monthSummary } = await dashboardHelpers();
  const contextRows = [
    { di:0, date:"2026-06-30", campaign_id:1, spend:100, cost:113, cap_rev:60, broad_rev:40, rev:100, rev_adj:90, profit:-23 },
    { di:1, date:"2026-07-01", campaign_id:1, spend:100, cost:113, cap_rev:120, broad_rev:80, rev:200, rev_adj:180, profit:67 },
    { di:2, date:"2026-07-02", campaign_id:1, spend:50, cost:56.5, cap_rev:60, broad_rev:40, rev:100, rev_adj:90, profit:33.5 },
    { di:2, date:"2026-07-02", campaign_id:2, spend:100, cost:113, cap_rev:70, broad_rev:30, rev:100, rev_adj:90, profit:-23 }
  ];
  const rows = monthSummary({
    contextRows,
    monthRows:contextRows.filter(row => row.date.startsWith("2026-07"))
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[1].campaigns, 2);
  assert.equal(rows[1].spend, 150);
  assert.equal(rows[1].cost, 169.5);
  assert.equal(rows[1].cap_rev, 130);
  assert.equal(rows[1].broad_rev, 70);
  assert.equal(rows[1].rev, 200);
  assert.equal(rows[1].rev_adj, 180);
  assert.equal(rows[1].profit, 10.5);
  assert.equal(rows[1].cap_rev + rows[1].broad_rev, rows[1].rev);
  assert.equal(rows[0].d1, -23 / 113 * 100);
  assert.equal(rows[1].d1, 67 / 113 * 100);
  assert.equal(rows[1].d2, -23 / 113 * 100);
  assert.equal(rows[1].last7, 54.5 / 395.5 * 100);
});

test("totals() aggregates cap/broad revenue and preserves the cap+broad=gross invariant", async () => {
  const { totals } = await dashboardHelpers();
  const rows = [
    { spend:100, cost:113, cap_rev:60, broad_rev:40, rev:100, rev_adj:90, profit:-23 },
    { spend:100, cost:113, cap_rev:120, broad_rev:80, rev:200, rev_adj:180, profit:67 }
  ];
  const all = totals(rows);

  assert.equal(all.capRev, 180);
  assert.equal(all.broadRev, 120);
  assert.equal(all.gross, 300);
  assert.equal(all.capRev + all.broadRev, all.gross);
});

test("campaign periods use calendar windows and preserve missing-day coverage", async () => {
  const { state, calendarDays, modalWindow, roiForDays, roiForRow } = await dashboardHelpers();
  state.days = [
    { di:10, date:"2026-07-10" },
    { di:12, date:"2026-07-12" },
    { di:13, date:"2026-07-13" }
  ];
  state.range = 3;
  state.start = "";
  state.end = "";
  const rows = [
    { di:10, date:"2026-07-10", campaign_id:9, cost:10, profit:4 },
    { di:12, date:"2026-07-12", campaign_id:9, cost:20, profit:-2 },
    { di:13, date:"2026-07-13", campaign_id:9, cost:30, profit:9 }
  ];

  const panel = modalWindow(rows, "panel");
  const lastSeven = modalWindow(rows, "7", 13);
  const selectedDay = modalWindow(rows, "1", 12);
  const complete = modalWindow(rows, "complete");

  assert.deepEqual(panel.expectedDays.map(day => day.date), ["2026-07-10", "2026-07-12", "2026-07-13"]);
  assert.deepEqual(lastSeven.expectedDays.map(day => day.date), calendarDays(7, "2026-07-13").map(day => day.date));
  assert.equal(lastSeven.range, "07/07/26 → 13/07/26");
  assert.deepEqual(selectedDay.rows.map(row => row.di), [12]);
  assert.deepEqual(complete.rows.map(row => row.di), [10, 12, 13]);
  assert.equal(roiForDays(lastSeven.rows, lastSeven.expectedDays).coverage, 3);
  assert.equal(roiForRow({ cost:0, profit:20 }), null);
});

test("daily popup has summary cards, drill-down rows and the complete financial table", async () => {
  const source = await dashboardSource();
  const dayMarkup = source.slice(
    source.indexOf("function dayModalMarkup"),
    source.indexOf("function campaignMeta")
  );
  assert.match(dayMarkup, /aria-label="Resumo financeiro de \$\{date\(day\?\.date\)\}"/);
  for (const heading of ["Gasto total", "Custo total", "Rec. Cap", "Rec. Broad", "Rec. Bruta", "Rec. líquida", "Lucro", "ROI"]) {
    assert.match(dayMarkup, new RegExp(`<span>${heading}</span>`));
  }
  assert.match(dayMarkup, /class="day-table"/);
  assert.match(dayMarkup, /data-day-campaign="\$\{row\.campaign_id\}"/);
  assert.match(dayMarkup, /sortableHead\("Rec\. Cap", "cap_rev"/);
  assert.match(dayMarkup, /sortableHead\("Rec\. Broad", "broad_rev"/);
  assert.match(dayMarkup, /sortableHead\("Rec\. Bruta", "rev"/);
  assert.match(dayMarkup, /sortableHead\("Rec\. Líq\.", "rev_adj"/);
  assert.match(dayMarkup, /<td>\$\{moneyPrecise\(row\.cap_rev\)\}<\/td>/);
  assert.match(dayMarkup, /<td>\$\{moneyPrecise\(row\.broad_rev\)\}<\/td>/);
  assert.match(dayMarkup, /sortableHead\("D-1"/);
  assert.match(dayMarkup, /sortableHead\("D-2"/);
  assert.match(dayMarkup, /sortableHead\("Últ\. 7"/);
  assert.match(dayMarkup, /sortableHead\("Últ\. 14"/);
  assert.match(dayMarkup, /sortableHead\("Status"/);
  assert.match(dayMarkup, /nenhum gasto do Meta Ads está registrado para este dia/);
  assert.match(dayMarkup, /confirme o arquivo do Meta Ads antes de interpretar como retorno real/);
});

test("day popup exposes a persistent search field, an active-filter subtitle and an empty state", async () => {
  const source = await dashboardSource();
  const dayMarkup = source.slice(
    source.indexOf("function dayModalMarkup"),
    source.indexOf("function campaignMeta")
  );
  assert.match(dayMarkup, /class="table-tools"><input data-day-search value="\$\{escape\(route\.search \|\| ""\)\}"/);
  assert.match(dayMarkup, /aria-label="Buscar campanha no dia"/);
  assert.match(dayMarkup, /filtro "\$\{escape\(route\.search\)\}" ativo/);
  assert.match(dayMarkup, /Nenhuma campanha corresponde a "\$\{escape\(route\.search \|\| ""\)\}" neste dia/);
  assert.match(dayMarkup, /colspan="14"/);

  const openDaySource = source.slice(
    source.indexOf("function openDayFromMonth"),
    source.indexOf("function openCampaignModal")
  );
  assert.match(openDaySource, /search:""/);

  const renderModalSource = source.slice(
    source.indexOf("function renderNavigationModal"),
    source.indexOf("function openMonthModal")
  );
  assert.match(renderModalSource, /root\.querySelector\("\[data-day-search\]"\)/);
  assert.match(renderModalSource, /route\.search = event\.target\.value/);
  assert.match(renderModalSource, /restored\.setSelectionRange\(cursor, cursor\)/);
});

test("dayCampaignRows filters by label, suffix and niche so the day popup search matches the ranking search", async () => {
  const { dayCampaignRows } = await dashboardHelpers();
  const contextRows = [
    { di:5, date:"2026-07-05", campaign_id:1, label:"MX Broad A", suffix:"MX01", niche:"saude", spend:10, cost:11, cap_rev:5, broad_rev:5, rev:10, rev_adj:9, profit:-2 },
    { di:5, date:"2026-07-05", campaign_id:2, label:"BR Cap B", suffix:"BR02", niche:"financas", spend:20, cost:22, cap_rev:12, broad_rev:8, rev:20, rev_adj:18, profit:-4 },
    { di:6, date:"2026-07-06", campaign_id:3, label:"MX Cap C", suffix:"MX03", niche:"saude", spend:5, cost:6, cap_rev:3, broad_rev:2, rev:5, rev_adj:4.5, profit:-1 }
  ];
  const route = { di:5, contextRows, search:"" };

  assert.deepEqual(dayCampaignRows(route).map(row => row.campaign_id), [1, 2]);

  route.search = "MX";
  assert.deepEqual(dayCampaignRows(route).map(row => row.campaign_id), [1]);

  route.search = "financas";
  assert.deepEqual(dayCampaignRows(route).map(row => row.campaign_id), [2]);

  route.search = "  mx  ";
  assert.deepEqual(dayCampaignRows(route).map(row => row.campaign_id), [1], "search should be case-insensitive and tolerate surrounding whitespace");

  route.search = "nenhuma campanha bate com isso";
  assert.deepEqual(dayCampaignRows(route), []);
});

test("campaign history table breaks revenue into cap/broad/gross/net columns", async () => {
  const source = await dashboardSource();
  const campaignMarkup = source.slice(
    source.indexOf("function campaignModalMarkup"),
    source.indexOf("function renderNavigationModal")
  );
  assert.match(campaignMarkup, /sortableHead\("Rec\. Cap", "cap_rev"/);
  assert.match(campaignMarkup, /sortableHead\("Rec\. Broad", "broad_rev"/);
  assert.match(campaignMarkup, /sortableHead\("Rec\. Bruta", "rev"/);
  assert.match(campaignMarkup, /sortableHead\("Rec\. Líq\.", "rev_adj"/);
  assert.match(campaignMarkup, /<td>\$\{moneyPrecise\(row\.cap_rev\)\}<\/td>/);
  assert.match(campaignMarkup, /<td>\$\{moneyPrecise\(row\.broad_rev\)\}<\/td>/);
  assert.match(campaignMarkup, /colspan="10"/);
});

test("zero cost with revenue is represented by a minimal accessible infinity symbol", async () => {
  const source = await dashboardSource();
  const { comparisonCell, roiText } = await dashboardHelpers();

  assert.match(roiText(null), /class="infinite-roi"/);
  assert.match(roiText(null), />∞<\/span>/);
  assert.match(roiText(null), /aria-label="Infinito: receita com custo zerado"/);
  assert.match(comparisonCell(null), />∞<\/span>/);
  assert.equal(comparisonCell(undefined), "—");
  assert.doesNotMatch(source, /Sem custo/);
});

test("every table supports ascending and descending sorting", async () => {
  const { sortRows } = await dashboardHelpers();
  const rows = [
    { label:"Campanha 10", profit:10, optional:null },
    { label:"Campanha 2", profit:-5, optional:2 },
    { label:"África", profit:30, optional:1 }
  ];
  assert.deepEqual(sortRows(rows, { key:"profit", direction:"asc" }).map(row => row.profit), [-5, 10, 30]);
  assert.deepEqual(sortRows(rows, { key:"profit", direction:"desc" }).map(row => row.profit), [30, 10, -5]);
  assert.deepEqual(sortRows(rows, { key:"label", direction:"asc" }).map(row => row.label), ["África", "Campanha 2", "Campanha 10"]);
  assert.deepEqual(sortRows(rows, { key:"optional", direction:"asc" }).map(row => row.optional), [1, 2, null]);
});

test("the popup flow behaves like browser history and only X closes it", async () => {
  const source = await dashboardSource();
  assert.match(source, /modalStack: \[\]/);
  assert.match(source, /state\.modalStack\.push\(route\)/);
  assert.match(source, /state\.modalStack\.pop\(\)/);
  assert.match(source, /data-modal-back/);
  assert.match(source, /data-close-navigation/);
  assert.match(source, /aria-label="Fechar todos os pop-ups"/);
  assert.doesNotMatch(source, /querySelector\("\.modal-backdrop"\)/);
  assert.match(source, /route\.tableScrollTop = scroller\?\.scrollTop/);
  assert.match(source, /scroller\.scrollTop = route\.tableScrollTop/);
  assert.match(source, /window\.scrollTo\(\{ top:state\.modalBaseScroll, behavior:"auto" \}\)/);
  assert.match(source, /opener\?\.focus\?\.\(\{ preventScroll:true \}\)/);
});

test("campaign details keep their own filters, chart and exact comparisons", async () => {
  const source = await dashboardSource();
  assert.match(source, /\{ id:"panel", label:"Período do painel" \}/);
  assert.match(source, /\{ id:"14", label:"14 dias" \}/);
  assert.match(source, /\{ id:"complete", label:"Histórico completo" \}/);
  assert.match(source, /data-modal-scope/);
  assert.match(source, /function comparisonMarkup/);
  assert.match(source, /if \(!daysEqual\(selectedWindow\.expectedDays, lastSeven\)\)/);
  assert.match(source, /<h3>Evolução diária<\/h3>/);
  assert.match(source, /chart\(selected\.rows, `Evolução diária de/);
});

test("cost, revenue and concise negative-streak rules remain explicit", async () => {
  const source = await dashboardSource();
  assert.match(source, /Custo = gasto do Meta Ads \+ 13% de imposto/);
  assert.match(source, /Receita líquida = GAM − 10% de Rev Share/);
  assert.match(source, /detalhe:"ROI negativo, três dias consecutivos\."/);
  assert.doesNotMatch(source, /últimos 3:/);
});

test("the action panel reserves space for impact without overlapping campaign names", async () => {
  const source = await dashboardSource();
  assert.match(source, /\.alert \{[\s\S]*?grid-template-columns:max-content minmax\(0,1fr\) 58px/);
  assert.match(source, /\.alert > span:nth-child\(2\) \{ min-width:0; \}/);
  assert.match(source, /\.alert-title \{ display:block; overflow-wrap:anywhere/);
  assert.match(source, /\.impact \{ width:58px;/);
});
