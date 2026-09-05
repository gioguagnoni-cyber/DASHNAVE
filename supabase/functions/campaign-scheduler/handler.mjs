import { plannedState } from "../../../docs/assets/schedule-core.mjs";

const ACCOUNT_ID = /^[0-9]+$/;
const allowedOrigins = new Set(["https://gioguagnoni-cyber.github.io"]);
class SafeError extends Error { constructor(code) { super(code);this.code=code; } }

export function createHandler(env, { fetchImpl=fetch, clock=()=>new Date() } = {}) {
  const base = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  async function db(path, { method="GET",body,prefer }={}) {
    const response=await fetchImpl(`${base}/rest/v1/${path}`, {
      method,headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw new SafeError("DATABASE_UNAVAILABLE");
    const text=await response.text();return text?JSON.parse(text):null;
  }
  async function all(path) {
    const result=[];
    for(let offset=0;;offset+=500) {
      const rows=await db(`${path}&limit=500&offset=${offset}`);result.push(...rows);
      if(rows.length<500)return result;
    }
  }
  const rpc=(name,body)=>db(`rpc/${name}`,{method:"POST",body});
  function credentials(accountId) {
    const token=env[`META_ACCESS_TOKEN_${accountId}`],version=env.META_GRAPH_VERSION;
    if(!token || !/^v\d+\.\d+$/.test(version||""))throw new SafeError("META_NOT_CONFIGURED");
    return {token,version};
  }
  async function meta(accountId,path,body) {
    const {token,version}=credentials(accountId);
    const response=await fetchImpl(`https://graph.facebook.com/${version}/${path}`, {
      method:body?"POST":"GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)
    });
    const result=await response.json();
    if(!response.ok || result.error) {
      // Do not persist raw provider messages/URLs, which can include credentials.
      const code=result.error?.code;
      throw new SafeError(code===190?"META_AUTH_EXPIRED":code===10||code===200?"META_PERMISSION_DENIED":response.status===429?"META_RATE_LIMIT":"META_REQUEST_FAILED");
    }
    return result;
  }
  async function sync(accountId) {
    const identity=await meta(accountId,`act_${accountId}?fields=id,account_id,account_status`);
    if(String(identity.account_id)!==accountId || Number(identity.account_status)!==1)throw new SafeError("META_ACCOUNT_UNAVAILABLE");
    const campaigns=[],seen=new Set();let cursor="";
    do {
      const result=await meta(accountId,`act_${accountId}/campaigns?fields=id,account_id,name,status,effective_status&limit=100${cursor?`&after=${encodeURIComponent(cursor)}`:""}`);
      if(!Array.isArray(result.data))throw new SafeError("META_INVALID_CATALOG");
      for(const campaign of result.data) {
        if(String(campaign.account_id)!==accountId || !ACCOUNT_ID.test(campaign.id))throw new SafeError("META_ACCOUNT_MISMATCH");
        campaigns.push(campaign);
      }
      if(!result.paging?.next)break;
      cursor=result.paging?.cursors?.after;
      if(!cursor||seen.has(cursor)||seen.size>=100)throw new SafeError("META_INCOMPLETE_PAGINATION");
      seen.add(cursor);
    }while(true);
    const count=await rpc("automation_replace_catalog",{p_account_id:accountId,p_campaigns:campaigns});
    await db(`automation_accounts?account_id=eq.${accountId}`,{method:"PATCH",body:{connection_state:"ready",updated_at:clock().toISOString()}});
    return count;
  }
  async function eligible(schedule,claim,plan) {
    const [rules,accounts,leases]=await Promise.all([
      db(`automation_schedules?account_id=eq.${schedule.account_id}&campaign_id=eq.${schedule.campaign_id}&revision=eq.${schedule.revision}&enabled=eq.true&select=*`),
      db(`automation_accounts?account_id=eq.${schedule.account_id}&execution_enabled=eq.true&connection_state=eq.ready&select=account_id`),
      db(`automation_runs?id=eq.${claim.id}&lease_token=eq.${claim.lease_token}&status=eq.running&select=lease_until`)
    ]);
    const fresh=rules[0]&&plannedState(rules[0],clock());
    return Boolean(accounts.length&&leases[0]&&Date.parse(leases[0].lease_until)>clock().getTime()+15000
      &&fresh?.desired_status===plan.desired_status&&fresh.window_key===plan.window_key);
  }
  async function processSchedule(schedule) {
    const plan=plannedState(schedule,clock());if(!plan)return "disabled";
    const claim=await rpc("automation_claim_run",{p_account_id:schedule.account_id,p_campaign_id:schedule.campaign_id,p_revision:schedule.revision,p_window_key:plan.window_key,p_desired_status:plan.desired_status});
    if(!claim)return "already_handled";
    let previous=null,confirmed=null;
    const finish=(status,error=null)=>rpc("automation_finish_run",{p_id:claim.id,p_lease_token:claim.lease_token,p_status:status,p_previous_status:previous,p_confirmed_status:confirmed,p_error_code:error});
    try {
      const campaign=await meta(schedule.account_id,`${schedule.campaign_id}?fields=id,account_id,status,effective_status`);
      if(campaign.id!==schedule.campaign_id||String(campaign.account_id)!==schedule.account_id)throw new SafeError("META_ACCOUNT_MISMATCH");
      previous=campaign.status;
      if(!["ACTIVE","PAUSED"].includes(previous)) {await finish("skipped","CAMPAIGN_UNAVAILABLE");return "skipped";}
      if(!await eligible(schedule,claim,plan)) {await finish("skipped","RULE_OR_WINDOW_CHANGED");return "skipped";}
      if(previous!==plan.desired_status) {
        await meta(schedule.account_id,schedule.campaign_id,{status:plan.desired_status});
        const check=await meta(schedule.account_id,`${schedule.campaign_id}?fields=id,account_id,status,effective_status`);
        if(check.id!==schedule.campaign_id||String(check.account_id)!==schedule.account_id)throw new SafeError("META_ACCOUNT_MISMATCH");
        confirmed=check.status;
        if(confirmed!==plan.desired_status)throw new SafeError("META_STATUS_NOT_CONFIRMED");
        await db(`automation_campaigns?account_id=eq.${schedule.account_id}&campaign_id=eq.${schedule.campaign_id}`,{method:"PATCH",body:{status:check.status,effective_status:check.effective_status,seen_at:clock().toISOString()}});
      } else confirmed=previous;
      if(!await finish("succeeded"))return "lease_expired";
      return "succeeded";
    }catch(error) {
      await finish("failed",error instanceof SafeError?error.code:"EXECUTION_FAILED");
      if(["META_AUTH_EXPIRED","META_PERMISSION_DENIED","META_NOT_CONFIGURED"].includes(error.code)) {
        await db(`automation_accounts?account_id=eq.${schedule.account_id}`,{method:"PATCH",body:{execution_enabled:false,connection_state:"error",updated_at:clock().toISOString()}});
      }
      return "failed";
    }
  }
  async function run() {
    if(env.AUTOMATION_EXECUTION_ENABLED!=="true")return {status:"disabled",processed:0};
    const accounts=await all("automation_accounts?execution_enabled=eq.true&connection_state=eq.ready&select=account_id&order=account_id.asc");
    const tasks=[];
    for(const account of accounts) {
      // A fresh account-level check precedes each cycle; disabled accounts stop.
      try {
        const info=await meta(account.account_id,`act_${account.account_id}?fields=account_id,account_status`);
        if(String(info.account_id)!==account.account_id||Number(info.account_status)!==1)throw new SafeError("META_ACCOUNT_UNAVAILABLE");
        tasks.push(...await all(`automation_schedules?account_id=eq.${account.account_id}&enabled=eq.true&select=*&order=campaign_id.asc`));
        await db(`automation_accounts?account_id=eq.${account.account_id}`,{method:"PATCH",body:{last_worker_at:clock().toISOString()}});
      }catch {
        await db(`automation_accounts?account_id=eq.${account.account_id}`,{method:"PATCH",body:{execution_enabled:false,connection_state:"error",updated_at:clock().toISOString()}});
      }
    }
    const outcomes=[],deadline=Date.now()+95000;
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,tasks.length)},async()=>{
      while(index<tasks.length&&Date.now()<deadline) {
        const task=tasks[index++];
        try {outcomes.push(await processSchedule(task));}catch {outcomes.push("failed");}
      }
    }));
    return {status:"completed",processed:outcomes.length,deferred:tasks.length-outcomes.length,counts:outcomes.reduce((acc,value)=>({...acc,[value]:(acc[value]||0)+1}),{})};
  }
  return async request => {
    const origin=request.headers.get("Origin"),cors=origin&&allowedOrigins.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{};
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...cors,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type"}});
    if(request.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
    if(origin&&!allowedOrigins.has(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403);
    const authorization=request.headers.get("Authorization")||"";
    const isCron=Boolean(env.AUTOMATION_CRON_SECRET)&&authorization===`Bearer ${env.AUTOMATION_CRON_SECRET}`;
    if(!authorization.startsWith("Bearer "))return reply({error:"UNAUTHORIZED"},401);
    try {
      if(Number(request.headers.get("Content-Length")||0)>4096)return reply({error:"INVALID_REQUEST"},400);
      const text=await request.text();if(text.length>4096)return reply({error:"INVALID_REQUEST"},400);
      let body;try{body=JSON.parse(text);}catch{return reply({error:"INVALID_REQUEST"},400);}
      if(body.operation==="run") {
        if(!isCron)return reply({error:"UNAUTHORIZED"},401);
        return reply(await run());
      }
      if(body.operation!=="sync"||!ACCOUNT_ID.test(body.account_id||""))return reply({error:"INVALID_REQUEST"},400);
      if(!isCron) {
        const auth=await fetchImpl(`${base}/auth/v1/user`,{headers:{apikey:service,Authorization:authorization},signal:AbortSignal.timeout(10000)});
        if(!auth.ok)return reply({error:"UNAUTHORIZED"},401);
        const user=await auth.json();
        if(!user.id)return reply({error:"UNAUTHORIZED"},401);
        const members=await db(`automation_members?account_id=eq.${body.account_id}&user_id=eq.${encodeURIComponent(user.id)}&select=account_id&limit=1`);
        if(!members.length)return reply({error:"FORBIDDEN"},403);
      }
      const allowed=await db(`automation_accounts?account_id=eq.${body.account_id}&select=account_id&limit=1`);
      if(!allowed.length)return reply({error:"ACCOUNT_NOT_CONFIGURED"},404);
      return reply({status:"synced",campaigns:await sync(body.account_id)});
    }catch(error) {return reply({error:error instanceof SafeError?error.code:"REQUEST_FAILED"},503);}
  };
}
