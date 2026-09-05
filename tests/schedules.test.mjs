import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaults,localClock,plannedState,nextTransition,validateSchedule } from "../docs/assets/schedule-core.mjs";
import { createHandler } from "../supabase/functions/campaign-scheduler/handler.mjs";

const active=extra=>({...defaults(),enabled:true,...extra});
const json=data=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-service",AUTOMATION_CRON_SECRET:"test-cron",META_GRAPH_VERSION:"v99.0",META_ACCESS_TOKEN_123:"test-meta",AUTOMATION_EXECUTION_ENABLED:"true"};
const req=(body,token="test-cron")=>new Request("https://example.supabase.co/functions/v1/campaign-scheduler",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});

test("the scheduling timezone stays in Brasília even for USD accounts",()=>{
  assert.deepEqual(localClock(new Date("2026-09-05T02:59:00Z")),{date:"2026-09-04",time:"23:59",weekday:5});
  assert.equal(plannedState(active(),new Date("2026-09-04T12:00:00Z")).desired_status,"PAUSED");
});
test("00:01–09:00 boundaries are inclusive/exclusive and skipped wakeups never activate late",()=>{
  for(const [time,status] of [["03:00:59","PAUSED"],["03:01:00","ACTIVE"],["11:59:59","ACTIVE"],["12:00:00","PAUSED"],["15:00:00","PAUSED"]]) {
    assert.equal(plannedState(active(),new Date(`2026-09-04T${time}Z`)).desired_status,status,time);
  }
  assert.equal(plannedState(active(),new Date("2026-09-04T12:20:00Z")).window_key,"2026-09-04T09:00");
});
test("excluded weekends pause and disabled schedules do nothing",()=>{
  assert.equal(plannedState(active(),new Date("2026-09-05T08:00:00Z")).desired_status,"PAUSED");
  assert.equal(plannedState(defaults(),new Date("2026-09-04T08:00:00Z")),null);
  assert.equal(plannedState(active({weekdays:[6,7]}),new Date("2026-09-05T08:00:00Z")).desired_status,"ACTIVE");
});
test("invalid time windows and weekdays cannot be scheduled",()=>{
  for(const change of [{weekdays:[]},{weekdays:[1,1]},{weekdays:[0]},{weekdays:[null]},{start_time:"09:00",end_time:"09:00"},{start_time:"22:00",end_time:"08:00"},{start_time:"25:00"},{start_time:"08:00:12"},{timezone:"America/Los_Angeles"}])assert.ok(validateSchedule(active(change)).length,JSON.stringify(change));
  assert.deepEqual(validateSchedule(active()),[]);
});
test("next event crosses weekends and months correctly",()=>{
  assert.deepEqual(nextTransition(active(),new Date("2026-09-04T12:00:00Z")),{at:"2026-09-07T03:01:00.000Z",status:"ACTIVE"});
  assert.deepEqual(nextTransition(active({weekdays:[1,2,3,4,5,6,7]}),new Date("2026-09-30T23:00:00Z")),{at:"2026-10-01T03:01:00.000Z",status:"ACTIVE"});
});
test("event identity remains stable inside a window and changes at its boundary",()=>{
  assert.equal(plannedState(active(),new Date("2026-09-04T04:00:00Z")).window_key,plannedState(active(),new Date("2026-09-04T10:00:00Z")).window_key);
  assert.notEqual(plannedState(active(),new Date("2026-09-04T10:00:00Z")).window_key,plannedState(active(),new Date("2026-09-04T12:00:00Z")).window_key);
});
test("unauthorized calls cannot run jobs; pending deployment makes no outbound requests",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new Error("unexpected request");};
  const pending=createHandler({...env,AUTOMATION_EXECUTION_ENABLED:"false"},{fetchImpl});
  assert.equal((await pending(req({operation:"run"},"visitor"))).status,401);
  assert.deepEqual(await (await pending(req({operation:"run"}))).json(),{status:"disabled",processed:0});
  assert.equal((await createHandler({...env,AUTOMATION_CRON_SECRET:""},{fetchImpl})(req({operation:"run"}))).status,401);
  assert.equal(calls,0);
});
test("a valid user without account membership cannot synchronize another account",async()=>{
  const calls=[];
  const handler=createHandler(env,{fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith("/auth/v1/user"))return json({id:"allowed-user"});
    if(url.includes("automation_members?"))return json([]);
    throw new Error("unexpected");
  }});
  assert.equal((await handler(req({operation:"sync",account_id:"999"},"user-token"))).status,403);
  assert.equal(calls.some(url=>url.includes("graph.facebook.com")),false);
});

function fakeWorker({wrongAccount=false,expiredWindow=false,claimExists=true,actual="PAUSED",finishOk=true}={}) {
  const requests=[],finished=[];let mutation=false;
  const schedule={...active(),account_id:"123",campaign_id:"456",revision:1};
  const claim={id:"run-id",lease_token:"lease-token"};
  const fetchImpl=async(url,options={})=>{
    requests.push({url,options});
    const body=options.body?JSON.parse(options.body):null;
    if(url.includes("graph.facebook.com")) {
      if(url.includes("act_123?"))return json({account_id:"123",account_status:1});
      if(options.method==="POST") {mutation=true;assert.deepEqual(body,{status:"ACTIVE"});return json({success:true});}
      return json({id:"456",account_id:wrongAccount?"999":"123",status:mutation?"ACTIVE":actual,effective_status:mutation?"ACTIVE":actual});
    }
    if(url.includes("/rpc/automation_claim_run"))return json(claimExists?claim:null);
    if(url.includes("/rpc/automation_finish_run")) {finished.push(body);return json(finishOk);}
    if(options.method==="PATCH")return new Response(null,{status:204});
    if(url.includes("automation_accounts?"))return json([{account_id:"123"}]);
    if(url.includes("automation_runs?"))return json([{lease_until:"2026-09-04T08:02:00Z"}]);
    if(url.includes("automation_schedules?"))return json(expiredWindow && url.includes("revision=")?[]:[schedule]);
    throw new Error(`Unexpected test route: ${url}`);
  };
  return {handler:createHandler(env,{fetchImpl,clock:()=>new Date("2026-09-04T08:00:00Z")}),requests,finished,get mutation(){return mutation;}};
}
test("worker writes status only, validates account and confirms the resulting status",async()=>{
  const fake=fakeWorker();const response=await fake.handler(req({operation:"run"}));
  assert.equal(response.status,200);assert.equal(fake.mutation,true);
  assert.equal(fake.finished[0].p_confirmed_status,"ACTIVE");assert.equal(fake.finished[0].p_status,"succeeded");
  const graphWrites=fake.requests.filter(item=>item.url.includes("graph.facebook.com")&&item.options.method==="POST");
  assert.equal(graphWrites.length,1);assert.deepEqual(JSON.parse(graphWrites[0].options.body),{status:"ACTIVE"});
});
test("wrong-account campaigns, expired rules, duplicate events and already-correct status are never mutated",async()=>{
  for(const options of [{wrongAccount:true},{expiredWindow:true},{claimExists:false},{actual:"ACTIVE"}]) {
    const fake=fakeWorker(options);await fake.handler(req({operation:"run"}));assert.equal(fake.mutation,false,JSON.stringify(options));
    if(options.wrongAccount)assert.equal(fake.finished[0].p_error_code,"META_ACCOUNT_MISMATCH");
  }
});
test("a worker that lost its lease does not report success",async()=>{
  const fake=fakeWorker({finishOk:false});
  const result=await (await fake.handler(req({operation:"run"}))).json();assert.equal(result.counts.lease_expired,1);
});
test("catalog synchronization fetches every page before replacing data, without activating execution",async()=>{
  const writes=[];let pages=0;
  const handler=createHandler(env,{fetchImpl:async(url,options={})=>{
    if(url.includes("automation_accounts?")&&options.method==="GET")return json([{account_id:"123"}]);
    if(url.includes("act_123?"))return json({account_id:"123",account_status:1});
    if(url.includes("/campaigns?")) {pages++;return json({data:[{id:String(450+pages),account_id:"123",name:`Campaign ${pages}`,status:"ACTIVE",effective_status:"ACTIVE"}],...(pages===1?{paging:{next:"https://do-not-follow.invalid?access_token=secret",cursors:{after:"cursor2"}}}:{})});}
    if(options.method==="POST"||options.method==="PATCH") {writes.push(JSON.parse(options.body));return json(2);}
    throw new Error(url);
  }});
  const response=await handler(req({operation:"sync",account_id:"123"}));assert.equal(response.status,200);
  assert.equal(pages,2);assert.equal(writes[0].p_campaigns.length,2);assert.equal(writes[1].execution_enabled,undefined);
});
test("failed later catalog pages leave the previous catalog untouched",async()=>{
  let writes=0;
  const handler=createHandler(env,{fetchImpl:async(url,options={})=>{
    if(url.includes("automation_accounts?"))return json([{account_id:"123"}]);
    if(url.includes("act_123?"))return json({account_id:"123",account_status:1});
    if(url.includes("after="))return new Response(JSON.stringify({error:{code:190,message:"secret"}}),{status:400});
    if(url.includes("/campaigns?"))return json({data:[],paging:{next:"next",cursors:{after:"last"}}});
    if(options.method==="POST")writes++;
    throw new Error(url);
  }});
  const response=await handler(req({operation:"sync",account_id:"123"}));
  assert.equal(response.status,503);assert.equal(writes,0);assert.equal((await response.text()).includes("secret"),false);
});
test("browser integration is lazy and styles are confined to the new area",async()=>{
  const html=await readFile(new URL("../docs/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../docs/assets/schedules.mjs",import.meta.url),"utf8");
  assert.match(html,/await import\("\.\/assets\/schedules\.mjs"\)/);
  assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*schedules/);
  assert.match(ui,/attachShadow/);assert.match(ui,/showModal/);
  assert.doesNotMatch(ui,/localStorage\.setItem|service_role|META_ACCESS_TOKEN/);
});
