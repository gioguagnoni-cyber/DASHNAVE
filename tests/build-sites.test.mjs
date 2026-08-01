import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("../scripts/build-sites.mjs", import.meta.url));
const distPath = fileURLToPath(new URL("../dist", import.meta.url));
const workerPath = fileURLToPath(new URL("../dist/server/index.js", import.meta.url));
const hostingPath = fileURLToPath(new URL("../dist/.openai/hosting.json", import.meta.url));

async function build() {
  await rm(distPath, { recursive:true, force:true });
  return run(process.execPath, [script], { cwd:root });
}

async function workerModule() {
  return import(`${new URL("../dist/server/index.js", import.meta.url).href}?build=${Date.now()}`);
}

test("build-sites bundles docs/index.html into the worker and copies the hosting config", async t => {
  t.after(() => rm(distPath, { recursive:true, force:true }));

  const { stdout } = await build();
  assert.match(stdout, /Sites build created from docs\/index\.html/);

  const [html, worker, hosting] = await Promise.all([
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
    readFile(workerPath, "utf8"),
    readFile(hostingPath, "utf8")
  ]);
  const expectedHosting = await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8");

  assert.equal(hosting, expectedHosting);
  assert.match(worker, /^const HTML = /);
  assert.ok(worker.includes(JSON.stringify(html)), "the worker embeds the dashboard verbatim");
  assert.ok((await stat(workerPath)).isFile());
});

test("the generated worker serves the dashboard only on / and /index.html", async t => {
  t.after(() => rm(distPath, { recursive:true, force:true }));

  await build();
  const { default:worker } = await workerModule();
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");

  for (const path of ["/", "/index.html"]) {
    const response = await worker.fetch(new Request(`https://dashnave.test${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(await response.text(), html);
  }

  const missing = await worker.fetch(new Request("https://dashnave.test/outra-rota"));
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(await missing.text(), "Not Found");

  const query = await worker.fetch(new Request("https://dashnave.test/?p=7#ini=2026-07-01"));
  assert.equal(query.status, 200, "query strings and hashes still resolve to the dashboard");
});

test("rebuilding replaces the previous dist output", async t => {
  t.after(() => rm(distPath, { recursive:true, force:true }));

  await build();
  const first = await readFile(workerPath, "utf8");
  await run(process.execPath, [script], { cwd:root });
  assert.equal(await readFile(workerPath, "utf8"), first);
});
