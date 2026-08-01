import assert from "node:assert/strict";
import test from "node:test";

import { dashboardRuntime } from "./helpers/dashboard-runtime.mjs";

const money = value => value.replace(/\u00a0/g, " ");

test("number() coerces anything non numeric to zero", async () => {
  const { number } = await dashboardRuntime();
  assert.equal(number("12.5"), 12.5);
  assert.equal(number(7), 7);
  assert.equal(number(null), 0);
  assert.equal(number(undefined), 0);
  assert.equal(number("abc"), 0);
  assert.equal(number(Infinity), 0);
  assert.equal(number(Number.NaN), 0);
});

test("currency, percentage and date formatters follow the pt-BR panel contract", async () => {
  const { money: brl, moneyPrecise, pct, date, shortDate, monthLabel } = await dashboardRuntime();
  assert.equal(money(brl(1234.56)), "R$ 1.235");
  assert.equal(money(brl("abc")), "R$ 0");
  assert.equal(money(moneyPrecise(1234.567)), "R$ 1.234,57");
  assert.equal(money(moneyPrecise(null)), "R$ 0,00");
  assert.equal(pct(3.14159), "+3.1%");
  assert.equal(pct(-2), "-2.0%");
  assert.equal(pct(0), "0.0%");
  assert.equal(date("2026-07-05"), "05/07/26");
  assert.equal(date(""), "—");
  assert.equal(shortDate("2026-07-05"), "05/07");
  assert.equal(monthLabel("2026-07-01"), "Julho de 2026");
});

test("tone and statusClass map values to the documented CSS classes", async () => {
  const { tone, statusClass } = await dashboardRuntime();
  assert.equal(tone(5), "positive");
  assert.equal(tone(-5), "negative");
  assert.equal(tone(0), "");
  assert.equal(tone("abc"), "");
  assert.equal(statusClass("3 dias negativos"), "alerta");
  assert.equal(statusClass("escalar"), "escalar");
  assert.equal(statusClass("desconhecido"), "sem-status");
  assert.equal(statusClass(undefined), "sem-status");
});

test("escape() neutralises every HTML sensitive character injected in the markup", async () => {
  const { escape } = await dashboardRuntime();
  assert.equal(escape(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(escape(null), "");
  assert.equal(escape(undefined), "");
  assert.equal(escape(42), "42");
});

test("readHash() accepts shared ranges and rejects unsupported quick periods", async () => {
  const quick = await dashboardRuntime({ hash:"#p=30" });
  assert.deepEqual(quick.readHash(), { range:30, start:"", end:"" });
  assert.equal(quick.state.range, 30);

  const custom = await dashboardRuntime({ hash:"#ini=2026-07-01&fim=2026-07-05" });
  assert.deepEqual(custom.readHash(), { range:7, start:"2026-07-01", end:"2026-07-05" });

  const invalid = await dashboardRuntime({ hash:"#p=9" });
  assert.deepEqual(invalid.readHash(), { range:7, start:"", end:"" });

  const empty = await dashboardRuntime();
  assert.deepEqual(empty.readHash(), { range:7, start:"", end:"" });
});

test("syncHash() writes the quick range or the custom interval into the URL", async () => {
  const runtime = await dashboardRuntime();
  runtime.state.range = 3;
  runtime.state.start = "";
  runtime.state.end = "";
  runtime.syncHash();
  assert.equal(runtime.replaceStateCalls.at(-1)[2], "/DASHNAVE/#p=3");

  runtime.state.start = "2026-07-01";
  runtime.state.end = "2026-07-02";
  runtime.syncHash();
  assert.equal(runtime.replaceStateCalls.at(-1)[2], "/DASHNAVE/#ini=2026-07-01&fim=2026-07-02");
});

test("selectedDays() honours a custom interval and otherwise takes the last N days", async () => {
  const { state, selectedDays } = await dashboardRuntime();
  state.days = [
    { di:1, date:"2026-07-01" },
    { di:2, date:"2026-07-02" },
    { di:3, date:"2026-07-03" }
  ];
  state.range = 2;
  state.start = "";
  state.end = "";
  assert.deepEqual(selectedDays().map(day => day.date), ["2026-07-02", "2026-07-03"]);

  state.start = "2026-07-01";
  state.end = "2026-07-02";
  assert.deepEqual(selectedDays().map(day => day.date), ["2026-07-01", "2026-07-02"]);
});

test("isoShift() and monthBounds() stay on calendar days across month borders", async () => {
  const { isoShift, monthBounds } = await dashboardRuntime();
  assert.equal(isoShift("2026-03-01", -1), "2026-02-28");
  assert.equal(isoShift("2024-02-28", 1), "2024-02-29");
  assert.equal(isoShift("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(monthBounds("2026-07"), {
    start:"2026-07-01",
    end:"2026-08-01",
    contextStart:"2026-06-18"
  });
  assert.equal(monthBounds("2026-12").end, "2027-01-01");
});

test("monthCoverage() returns an empty coverage when no day has a date", async () => {
  const { monthCoverage } = await dashboardRuntime();
  assert.deepEqual(monthCoverage([]), { first:null, last:null, periodDays:0, daysWithData:0, missing:[] });
  assert.deepEqual(monthCoverage([{ date:null }]), { first:null, last:null, periodDays:0, daysWithData:0, missing:[] });

  const single = monthCoverage([{ date:"2026-07-04" }, { date:"2026-07-04" }]);
  assert.deepEqual(single, {
    first:"2026-07-04",
    last:"2026-07-04",
    periodDays:1,
    daysWithData:1,
    missing:[]
  });
});

test("dailyRoi, roiForRow, totalRoi and comparisonCell separate zero cost from missing data", async () => {
  const { dailyRoi, roiForRow, totalRoi, comparisonCell, roiText } = await dashboardRuntime();
  assert.equal(dailyRoi({ cost:100, profit:25 }), 25);
  assert.equal(dailyRoi({ cost:0, profit:25 }), 0);
  assert.equal(roiForRow({ cost:100, profit:-50 }), -50);
  assert.equal(roiForRow({ cost:0, profit:5 }), null);
  assert.equal(totalRoi([]), null);
  assert.equal(totalRoi([{ cost:0, profit:10 }]), null);
  assert.equal(totalRoi([{ cost:200, profit:50 }, { cost:200, profit:-10 }]), 10);
  assert.equal(comparisonCell(undefined), "—");
  assert.equal(comparisonCell(null), roiText(null));
  assert.equal(comparisonCell(12.5), "+12.5%");
});

test("totals() defaults every missing metric to zero", async () => {
  const { totals } = await dashboardRuntime();
  assert.deepEqual(totals([]), { spend:0, cost:0, gross:0, revenue:0, profit:0, capRev:0, broadRev:0 });
  assert.deepEqual(totals([{ spend:"10", cost:null, rev:undefined, rev_adj:"x", profit:2 }]), {
    spend:10, cost:0, gross:0, revenue:0, profit:2, capRev:0, broadRev:0
  });
});

test("compareValues() pushes missing values last regardless of direction", async () => {
  const { compareValues } = await dashboardRuntime();
  assert.equal(compareValues(null, 5, "asc"), 1);
  assert.equal(compareValues(5, null, "asc"), -1);
  assert.equal(compareValues(null, undefined, "desc"), 0);
  assert.equal(compareValues(Number.NaN, 1, "desc"), 1);
  assert.equal(compareValues(1, 2, "asc"), -1);
  assert.equal(compareValues(1, 2, "desc"), 1);
  assert.ok(compareValues("Campanha 2", "Campanha 10", "asc") < 0, "numeric collation keeps 2 before 10");
});

test("sortRows() supports derived getters and never mutates the source array", async () => {
  const { sortRows } = await dashboardRuntime();
  const rows = [
    { label:"A", recomendacao:"pausar" },
    { label:"B", recomendacao:"acompanhar" },
    { label:"C" }
  ];
  const sorted = sortRows(rows, { key:"action", direction:"asc" }, { action:row => row.recomendacao || "acompanhar" });
  assert.deepEqual(sorted.map(row => row.label), ["B", "C", "A"]);
  assert.deepEqual(rows.map(row => row.label), ["A", "B", "C"]);
});

test("sortableHead() exposes the active direction through aria-sort and the arrow", async () => {
  const { sortableHead } = await dashboardRuntime();
  const inactive = sortableHead("Lucro", "profit", { key:"roi", direction:"asc" });
  assert.match(inactive, /aria-sort="none"/);
  assert.match(inactive, /data-modal-sort="profit"/);
  assert.match(inactive, /<span class="sort-arrow" aria-hidden="true"><\/span>/);

  const ascending = sortableHead("Lucro", "profit", { key:"profit", direction:"asc" }, "ranking");
  assert.match(ascending, /aria-sort="ascending"/);
  assert.match(ascending, /data-ranking-sort="profit"/);
  assert.match(ascending, /↑/);

  assert.match(sortableHead("Lucro", "profit", { key:"profit", direction:"desc" }), /aria-sort="descending"/);
});

test("calendarDays, daysEqual and the date pickers work on exact calendar windows", async () => {
  const { calendarDays, daysEqual, rowsForDate, rowsForRange, roiForDate, roiForRange } = await dashboardRuntime();
  const window = calendarDays(3, "2026-07-03");
  assert.deepEqual(window.map(day => day.date), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.equal(daysEqual(window, calendarDays(3, "2026-07-03")), true);
  assert.equal(daysEqual(window, calendarDays(4, "2026-07-03")), false);
  assert.equal(daysEqual(window, calendarDays(3, "2026-07-04")), false);

  const rows = [
    { date:"2026-07-01", cost:100, profit:10 },
    { date:"2026-07-02", cost:100, profit:-30 },
    { date:"2026-07-03", cost:0, profit:5 }
  ];
  assert.deepEqual(rowsForDate(rows, "2026-07-02").map(row => row.profit), [-30]);
  assert.deepEqual(rowsForRange(rows, "2026-07-02", "2026-07-03").map(row => row.date), ["2026-07-02", "2026-07-03"]);
  assert.equal(roiForDate(rows, "2026-07-01"), 10);
  assert.equal(roiForDate(rows, "2026-07-09"), undefined, "a day without rows is unknown, not zero");
  assert.equal(roiForDate(rows, "2026-07-03"), null, "revenue without cost is infinite ROI");
  assert.equal(roiForRange(rows, "2026-07-01", "2026-07-02"), -10);
  assert.equal(roiForRange(rows, "2026-08-01", "2026-08-31"), undefined);
});

test("roiForDays() reports coverage against the requested window", async () => {
  const { roiForDays } = await dashboardRuntime();
  const days = [{ date:"2026-07-01" }, { date:"2026-07-02" }, { date:"2026-07-03" }];
  const rows = [
    { date:"2026-07-01", cost:100, profit:20 },
    { date:"2026-07-01", cost:100, profit:-10 },
    { date:"2026-07-05", cost:100, profit:999 }
  ];
  assert.deepEqual(roiForDays(rows, days), { roi:5, coverage:1, requested:3 });
  assert.equal(roiForDays([], days), null);
  assert.deepEqual(roiForDays([{ date:"2026-07-02", cost:0, profit:8 }], days), { roi:null, coverage:1, requested:3 });
});

test("compare() renders the coverage note only when days are missing", async () => {
  const { compare } = await dashboardRuntime();
  assert.match(compare("D-1", null), /Não rodou/);
  const partial = compare("Últimos 7", { roi:-12, coverage:3, requested:7 });
  assert.match(partial, /class="negative"/);
  assert.match(partial, /-12\.0%/);
  assert.match(partial, /<small>3\/7 dias com dados<\/small>/);
  assert.doesNotMatch(compare("D-1", { roi:4, coverage:1, requested:1 }), /<small>/);
});

test("comparisonMarkup() skips the windows already shown by the selected scope", async () => {
  const { comparisonMarkup, calendarDays } = await dashboardRuntime();
  const rows = [{ date:"2026-07-10", cost:100, profit:10 }];
  assert.equal(comparisonMarkup(rows, { anchorDate:null, expectedDays:[] }), "");

  const full = comparisonMarkup(rows, { anchorDate:"2026-07-10", expectedDays:[] });
  assert.match(full, /D-1/);
  assert.match(full, /D-2/);
  assert.match(full, /Últimos 7/);
  assert.match(full, /Últimos 14/);

  const sevenDayScope = comparisonMarkup(rows, { anchorDate:"2026-07-10", expectedDays:calendarDays(7, "2026-07-10") });
  assert.doesNotMatch(sevenDayScope, /Últimos 7/);
  assert.match(sevenDayScope, /Últimos 14/);
});

test("aggregate() sums each day once and orders the series by day index", async () => {
  const { aggregate } = await dashboardRuntime();
  const series = aggregate([
    { di:2, date:"2026-07-02", spend:1, rev_adj:2, profit:3 },
    { di:1, date:"2026-07-01", spend:"x", rev_adj:1, profit:1 },
    { di:2, date:"2026-07-02", spend:4, rev_adj:1, profit:1 }
  ]);
  assert.deepEqual(series, [
    { di:1, date:"2026-07-01", spend:0, rev:1, profit:1 },
    { di:2, date:"2026-07-02", spend:5, rev:3, profit:4 }
  ]);
  assert.deepEqual(aggregate([]), []);
});

test("chart() falls back to an empty state and centers a single point", async () => {
  const { chart } = await dashboardRuntime();
  assert.match(chart([]), /class="empty">Não há resultado diário neste período\./);

  const single = chart([{ di:1, date:"2026-07-01", spend:10, rev_adj:5, profit:2 }], `Evolução "custom"`);
  assert.match(single, /<svg viewBox="0 0 720 245" role="img" aria-label="Evolução &quot;custom&quot;">/);
  assert.match(single, /<text class="axis" x="360" y="237" text-anchor="middle">01\/07<\/text>/);
  assert.equal(single.match(/<circle /g).length, 1);

  const many = chart([
    { di:1, date:"2026-07-01", spend:10, rev_adj:5, profit:2 },
    { di:2, date:"2026-07-02", spend:0, rev_adj:0, profit:-4 }
  ]);
  assert.equal(many.match(/<circle /g).length, 2);
  assert.equal(many.match(/<g>/g).length, 2);
});

test("deriveDashboard() groups campaigns, ranks by profit and derives trend and recommendation", async () => {
  const { deriveDashboard } = await dashboardRuntime();
  const daily = [
    { di:1, date:"2026-07-01", campaign_id:1, label:"Boa", suffix:"BR1", niche:"saude", cost:100, rev:300, rev_adj:280, spend:88, profit:80, qualidade:"ok" },
    { di:2, date:"2026-07-02", campaign_id:1, label:"Boa", cost:100, rev:300, rev_adj:280, spend:88, profit:120 },
    { di:1, date:"2026-07-01", campaign_id:2, label:"Fraca", cost:50, rev:10, rev_adj:9, spend:44, profit:-40, qualidade:"inconsistente" },
    { di:2, date:"2026-07-02", campaign_id:2, label:"Fraca", cost:50, rev:10, rev_adj:9, spend:44, profit:-45, qualidade:"suspeito" }
  ];
  const derived = deriveDashboard(daily);

  assert.deepEqual(derived.ranking.map(row => row.campaign_id), [1, 2], "ranking is ordered by profit");
  assert.equal(derived.ranking[0].roi, 100);
  assert.equal(derived.ranking[0].tendencia, "subindo");
  assert.equal(derived.ranking[0].recomendacao, "escalar");
  assert.equal(derived.ranking[1].recomendacao, "acompanhar", "cost below 150 never recommends pausing");
  assert.equal(derived.ranking[1].tendencia, "caindo");
  assert.equal(derived.summary.portfolio.campanhas, 2);
  assert.equal(derived.summary.portfolio.profit, 115);
  assert.equal(derived.summary.portfolio.roi, 115 / 300 * 100);
  assert.equal(derived.quality.inconsistentes, 1);
  assert.equal(derived.quality.suspeitos, 1);
  assert.equal(derived.alerts.length, 0, "two negative days are not a streak");
  assert.equal(derived.clientAlerts, derived.alerts);
  assert.equal(derived.daily, daily);
});

test("deriveDashboard() only alerts on three consecutive negative days with cost", async () => {
  const { deriveDashboard } = await dashboardRuntime();
  const negative = (di, profit) => ({ di, date:`2026-07-0${di}`, campaign_id:7, label:"Sequência", cost:100, rev:10, rev_adj:9, spend:88, profit });

  const broken = deriveDashboard([negative(1, -10), { ...negative(2, 5), profit:5 }, negative(3, -10), negative(4, -10)]);
  assert.equal(broken.alerts.length, 0);

  const streak = deriveDashboard([negative(1, -10), negative(2, -20), negative(3, -30)]);
  assert.equal(streak.alerts.length, 1);
  assert.deepEqual(streak.alerts[0], {
    campaign_id:7,
    label:"Sequência",
    tipo:"3 dias negativos",
    prioridade:0,
    impacto:60,
    detalhe:"ROI negativo, três dias consecutivos."
  });

  const gap = deriveDashboard([negative(1, -10), negative(2, -20), negative(9, -30)]);
  assert.equal(gap.alerts.length, 0, "non consecutive day indexes reset the streak");

  const zeroCost = deriveDashboard([
    { ...negative(1, -10), cost:0 },
    { ...negative(2, -20), cost:0 },
    { ...negative(3, -30), cost:0 }
  ]);
  assert.equal(zeroCost.alerts.length, 0, "days without cost cannot be negative ROI days");
});

test("deriveDashboard() marks single-day campaigns as undefined trend and lists partial days", async () => {
  const { state, deriveDashboard } = await dashboardRuntime();
  state.days = [{ di:1, date:"2026-07-01", badge:"parcial" }, { di:2, date:"2026-07-02" }];
  const derived = deriveDashboard([
    { di:1, date:"2026-07-01", campaign_id:3, label:"Única", cost:200, rev:100, rev_adj:90, spend:177, profit:-110 }
  ]);
  assert.equal(derived.ranking[0].tendencia, "indefinida");
  assert.equal(derived.ranking[0].recomendacao, "pausar");
  assert.deepEqual(derived.quality.dias_parciais, ["01/07/26"]);
});

test("historyMarkup() lists months from the newest and flags months with data gaps", async () => {
  const { state, historyMarkup } = await dashboardRuntime();
  state.days = [
    { di:1, date:"2026-06-01" },
    { di:2, date:"2026-07-01" },
    { di:3, date:"2026-07-03" }
  ];
  const markup = historyMarkup();
  assert.ok(markup.indexOf("2026-07") < markup.indexOf("2026-06"), "the newest month comes first");
  assert.match(markup, /<span>2 meses<\/span>/);
  assert.match(markup, /Julho de 2026<\/b><small>3 dias no período · 2 com dados<\/small>/);
  assert.match(markup, /Junho de 2026<\/b><small>1 dia no período<\/small>/);

  state.days = [{ di:1, date:"2026-07-01" }];
  assert.match(historyMarkup(), /<span>1 mês<\/span>/);
});

test("campaignMeta() prefers the ranking entry and falls back to the first row", async () => {
  const { state, campaignMeta } = await dashboardRuntime();
  state.data = { ranking:[{ campaign_id:5, label:"Do ranking" }] };
  assert.equal(campaignMeta("5", [{ campaign_id:5, label:"Da linha" }]).label, "Do ranking");
  assert.equal(campaignMeta(9, [{ campaign_id:9, label:"Da linha" }]).label, "Da linha");
  assert.deepEqual(campaignMeta(9, []), {});

  state.data = null;
  assert.equal(campaignMeta(5, [{ campaign_id:5, label:"Da linha" }]).label, "Da linha");
});

test("modalWindow() resolves each scope into the matching calendar window", async () => {
  const { state, modalWindow, calendarDays } = await dashboardRuntime();
  state.days = [
    { di:10, date:"2026-07-10" },
    { di:11, date:"2026-07-11" },
    { di:12, date:"2026-07-12" }
  ];
  state.range = 2;
  state.start = "";
  state.end = "";
  const rows = [
    { di:10, date:"2026-07-10", cost:10, profit:1 },
    { di:12, date:"2026-07-12", cost:10, profit:2 }
  ];

  const complete = modalWindow(rows, "complete");
  assert.equal(complete.isComplete, true);
  assert.equal(complete.label, "Histórico completo");
  assert.equal(complete.range, "10/07/26 → 12/07/26");
  assert.deepEqual(complete.expectedDays.map(day => day.date), ["2026-07-10", "2026-07-12"]);

  assert.equal(modalWindow([], "complete").range, "Sem dados");

  const panel = modalWindow(rows, "panel");
  assert.equal(panel.label, "Período do painel");
  assert.deepEqual(panel.expectedDays.map(day => day.date), ["2026-07-11", "2026-07-12"]);

  const threeDays = modalWindow(rows, "3", 12);
  assert.deepEqual(threeDays.expectedDays.map(day => day.date), calendarDays(3, "2026-07-12").map(day => day.date));
  assert.equal(threeDays.anchorDate, "2026-07-12");
  assert.deepEqual(threeDays.rows.map(row => row.di), [10, 12]);
});

test("monthSummary() groups by date, ignores context rows outside the month and compares with the context", async () => {
  const { monthSummary } = await dashboardRuntime();
  const contextRows = [
    { di:1, date:"2026-06-30", campaign_id:1, spend:10, cost:10, cap_rev:1, broad_rev:1, rev:2, rev_adj:2, profit:-8 },
    { di:3, date:"2026-07-02", campaign_id:1, spend:10, cost:10, cap_rev:5, broad_rev:5, rev:10, rev_adj:9, profit:-1 },
    { di:2, date:"2026-07-01", campaign_id:1, spend:10, cost:10, cap_rev:9, broad_rev:1, rev:10, rev_adj:9, profit:-1 }
  ];
  const rows = monthSummary({ contextRows, monthRows:contextRows.filter(row => row.date.startsWith("2026-07")) });
  assert.deepEqual(rows.map(row => row.date), ["2026-07-02", "2026-07-01"], "grouping keeps the order the month rows arrive in");
  assert.equal(rows.every(row => row.campaigns === 1), true);
  const [second, first] = rows;
  assert.equal(first.d1, -80, "the day before comes from the context rows outside the month");
  assert.equal(second.d2, -80);
  assert.equal(first.roi, -10);
  assert.deepEqual(monthSummary({ contextRows:[], monthRows:[] }), []);
});

test("dayCampaignRows() attaches the ROI comparison columns for each campaign", async () => {
  const { dayCampaignRows } = await dashboardRuntime();
  const contextRows = [
    { di:3, date:"2026-07-03", campaign_id:1, label:"Alfa", cost:100, profit:-50 },
    { di:4, date:"2026-07-04", campaign_id:1, label:"Alfa", cost:100, profit:20 },
    { di:5, date:"2026-07-05", campaign_id:1, label:"Alfa", cost:0, profit:5 },
    { di:5, date:"2026-07-05", campaign_id:2, label:"Beta", cost:100, profit:10 }
  ];
  const [alfa] = dayCampaignRows({ di:5, contextRows, search:"alfa" });
  assert.equal(alfa.calculatedRoi, null, "revenue without cost is infinite ROI");
  assert.equal(alfa.d1, 20);
  assert.equal(alfa.d2, -50);
  assert.equal(alfa.last7, -12.5, "the trailing window includes the selected day");
  assert.equal(alfa.last14, -12.5);

  const [beta] = dayCampaignRows({ di:5, contextRows, search:"beta" });
  assert.equal(beta.d1, undefined, "a campaign without the previous day has no comparison");
  assert.equal(beta.calculatedRoi, 10);
});
