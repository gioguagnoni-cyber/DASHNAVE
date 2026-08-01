import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "docs/index.html");
const distPath = resolve(root, "dist");
const serverPath = resolve(distPath, "server/index.js");
const hostingSource = resolve(root, ".openai/hosting.json");
const hostingTarget = resolve(distPath, ".openai/hosting.json");
const html = await readFile(sourcePath, "utf8");

const worker = `const HTML = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src https://akffepitbqqqgldxvtlf.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      }
    });
  }
};
`;

await rm(distPath, { recursive:true, force:true });
await mkdir(dirname(serverPath), { recursive:true });
await mkdir(dirname(hostingTarget), { recursive:true });
await writeFile(serverPath, worker, "utf8");
await cp(hostingSource, hostingTarget);

console.log("Sites build created from docs/index.html");
