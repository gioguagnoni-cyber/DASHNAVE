import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardUrl = new URL("../../docs/index.html", import.meta.url);

export async function dashboardSource() {
  return readFile(dashboardUrl, "utf8");
}

const EXPORTED = [
  "state", "number", "money", "moneyPrecise", "pct", "date", "shortDate", "monthLabel",
  "isoShift", "monthBounds", "monthCoverage", "tone", "statusClass", "escape", "readHash",
  "selectedDays", "totals", "dailyRoi", "roiForRow", "roiText", "totalRoi", "comparisonCell",
  "compareValues", "sortRows", "sortableHead", "deriveDashboard", "aggregate", "chart",
  "historyMarkup", "calendarDays", "daysEqual", "rowsForDate", "rowsForRange", "roiForDate",
  "roiForRange", "monthSummary", "dayCampaignRows", "modalWindow", "roiForDays", "compare",
  "comparisonMarkup", "campaignMeta", "currentRoute", "syncHash", "monthModalMarkup",
  "dayModalMarkup", "campaignModalMarkup"
];

/**
 * Evaluates the inline dashboard script without starting it and returns its helpers.
 * `hash` seeds the fake location so hash-driven state can be exercised.
 */
export async function dashboardRuntime({ hash = "" } = {}) {
  const source = await dashboardSource();
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "inline dashboard script must exist");
  const stoppedScript = script.replace(/\n\s*start\(\);\s*$/, "");
  const elements = new Map();
  const stubElement = () => ({
    innerHTML: "",
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    focus: () => {}
  });
  const fakeDocument = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, stubElement());
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const fakeWindow = { addEventListener: () => {}, scrollY:0, scrollTo: () => {} };
  const fakeLocation = { hash, pathname:"/DASHNAVE/", search:"" };
  const replaceStateCalls = [];
  const fakeHistory = {
    replaceState: (...args) => {
      replaceStateCalls.push(args);
    }
  };
  const helpers = new Function(
    "document",
    "window",
    "location",
    "history",
    `${stoppedScript}
      return { ${EXPORTED.join(", ")} };`
  )(fakeDocument, fakeWindow, fakeLocation, fakeHistory);

  return { ...helpers, elements, replaceStateCalls, location:fakeLocation };
}
