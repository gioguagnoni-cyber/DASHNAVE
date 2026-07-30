import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the DASHFULL application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>DASHFULL \| Performance diária<\/title>/i);
  assert.match(html, /DASHFULL/);
  assert.match(html, /Preparando os dados da DASHFULL/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("both dashboard clients explicitly request message campaigns", async () => {
  const [appClient, publicPage] = await Promise.all([
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(appClient, /v_daily\?typ=eq\.msgs/);
  assert.match(publicPage, /v_daily\?typ=eq\.msgs/);
});

test("dashboard derives filtered metrics and the negative-ROI alert from daily message rows", async () => {
  const [appClient, publicPage] = await Promise.all([
    readFile(new URL("../app/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
  ]);
  for (const source of [appClient, publicPage]) {
    assert.match(source, /deriveDashboard/);
    assert.match(source, /dailyRoi/);
    assert.match(source, /3 dias negativos/);
    assert.doesNotMatch(source, /dashboard_summary|campaign_ranking|operational_alerts|data_quality_status/);
  }
});
