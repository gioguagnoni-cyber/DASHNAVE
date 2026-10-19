import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHandler } from "../supabase/functions/campaign-scheduler/handler.mjs";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("budget automation is isolated to DIZZ 1 USD and starts fail-closed", async () => {
  const sql = await read("supabase/migrations/20261019120952_add_secure_budget_automation.sql");
  assert.match(sql, /account_id = '2948780535467215'/);
  assert.match(sql, /execution_enabled boolean not null default false/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all .* from anon/s);
});

test("worker freezes the target, verifies Meta and never receives financial tables", async () => {
  const worker = await read("supabase/functions/campaign-scheduler/handler.mjs");
  assert.match(worker, /resolved_budget_cents/);
  assert.match(worker, /META_VERIFICATION_MISMATCH/);
  assert.match(worker, /execution_enabled=eq\.true/);
  assert.doesNotMatch(worker, /msgs_results|push_daily_results|\bdays\b/);
});

test("public dashboard links to a protected automation page without embedding private credentials", async () => {
  const [dashboard, automation] = await Promise.all([read("docs/index.html"), read("docs/automation.html")]);
  assert.match(dashboard, /href="\.\/automation\.html"/);
  assert.match(automation, /A área de automação não aceita acesso anônimo/);
  assert.match(automation, /America\/Sao_Paulo/);
  assert.doesNotMatch(automation, /service_role|META_ACCESS_TOKEN|AUTOMATION_CRON_SECRET/);
});

test("worker applies a percentage once and verifies the budget returned by Meta", async () => {
  const schedule={ id:"00000000-0000-4000-8000-000000000001",account_id:"2948780535467215",campaign_id:"120000000000001",change_mode:"percent",change_percent:30,resolved_budget_cents:null };
  let metaBudget=1000,postedBudget=null;
  const response=value=>new Response(value==null?"":JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
  const fetchImpl=async(url,options={})=>{
    const target=String(url);
    if(target.includes("graph.facebook.com") && options.method==="POST") {
      postedBudget=Number(new URLSearchParams(options.body).get("daily_budget"));metaBudget=postedBudget;return response({success:true});
    }
    if(target.includes("graph.facebook.com")) return response({id:schedule.campaign_id,account_id:schedule.account_id,daily_budget:String(metaBudget)});
    if(target.includes("rpc/automation_verify_cron_secret")) return response(true);
    if(target.includes("rpc/automation_claim_budget_schedule")) return response({...schedule,lease_token:"00000000-0000-4000-8000-000000000002"});
    if(target.includes("rpc/automation_finish_budget_schedule")) return response(true);
    if(target.includes("automation_accounts?") && options.method!=="PATCH") return response([{account_id:schedule.account_id}]);
    if(target.includes("status=eq.pending")) return response([schedule]);
    if(target.includes("status=eq.running")) return response([]);
    return response(null);
  };
  const handler=createHandler({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service",META_ACCESS_TOKEN_2948780535467215:"token",META_GRAPH_VERSION:"v99.0"},{fetchImpl,clock:()=>new Date("2026-10-20T03:01:00Z"),uuid:()=>"00000000-0000-4000-8000-000000000002"});
  const result=await handler(new Request("https://example.test",{method:"POST",headers:{"content-type":"application/json","x-cron-secret":"valid"},body:JSON.stringify({operation:"run",account_id:schedule.account_id})}));
  const payload=await result.json();
  assert.equal(result.status,200);
  assert.equal(postedBudget,1300);
  assert.equal(payload.results[0].confirmed,1300);
});
