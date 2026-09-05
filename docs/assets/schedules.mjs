import { defaults, validateSchedule, nextTransition, WEEKDAYS } from "./schedule-core.mjs";

const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let session = null; // Memory only: never store credentials in a public page or localStorage.
let openHost = null;

export async function openSchedules({ account, url, key, opener }) {
  if (openHost || !account?.meta_account_id) return;
  const accountId = account.meta_account_id;
  const pageY = window.scrollY;
  const host = document.createElement("div");
  host.dataset.automationRoot = "true";
  const root = host.attachShadow({ mode:"open" });
  root.innerHTML = `<link rel="stylesheet" href="${new URL("./schedules.css", import.meta.url)}"><dialog aria-labelledby="schedule-title"><div class="header"><div><p class="eyebrow">AUTOMAÇÃO DE CAMPANHAS</p><h1 id="schedule-title">Agendamentos</h1><p class="account">${escape(account.display_name)} · Horário de Brasília</p></div><button type="button" class="close" data-close aria-label="Fechar agendamentos">×</button></div><div class="body"><div class="empty">Consultando as campanhas desta conta…</div></div></dialog>`;
  document.body.append(host);
  openHost = host;
  const dialog = root.querySelector("dialog");
  let closed = false, rows = [], connection = null, canEdit = false, query = "", loading = false;
  const configs = new Map();
  const saved = new Map();
  const dirty = new Set();
  const cleanup = () => {
    closed = true; host.remove(); openHost = null;
    const target = opener?.isConnected ? opener : document.querySelector("[data-open-schedules]");
    target?.focus({ preventScroll:true });
    window.scrollTo({ top:pageY, behavior:"auto" });
  };
  dialog.addEventListener("close", cleanup, { once:true });
  root.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  // Styles are lazy, but must be ready before the dialog enters the top layer.
  await Promise.race([
    new Promise(resolve => { const link = root.querySelector("link"); if (link.sheet) resolve(); else { link.onload = resolve; link.onerror = resolve; } }),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  dialog.showModal();

  async function request(path, { method="GET", body, authorized=false, prefer } = {}) {
    if (authorized && session && session.expiresAt < Date.now()+30000) {
      const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method:"POST", headers:{ apikey:key,"Content-Type":"application/json" },
        body:JSON.stringify({refresh_token:session.refresh_token}), signal:AbortSignal.timeout(15000)
      });
      if (!response.ok) { session=null; canEdit=false; throw new Error("Sua sessão expirou. Entre novamente para salvar."); }
      const data = await response.json(); session={...data,expiresAt:Date.now()+data.expires_in*1000};
    }
    const response = await fetch(`${url}/${path}`, {
      method, headers:{ apikey:key,"Content-Type":"application/json", ...(authorized && session ? { Authorization:`Bearer ${session.access_token}` } : {}), ...(prefer ? {Prefer:prefer} : {}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      if (response.status===401) {session=null;canEdit=false;throw new Error("Entre novamente para continuar.");}
      throw new Error(response.status===403 ? "Você não tem permissão para editar esta conta." : "Não foi possível concluir. Confira a conexão e tente novamente.");
    }
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  async function all(path, authorized=false) {
    const result=[];
    for(let offset=0;;offset+=500) {
      const page = await request(`${path}&limit=500&offset=${offset}`,{authorized});
      result.push(...page); if(page.length<500) return result;
    }
  }
  function feedback(message, error=false) {
    const node=root.querySelector("[data-feedback]");
    if(node) {node.textContent=message;node.className=`feedback${error?" error":""}`;}
  }
  function activationReady() { return canEdit && connection?.connection_state==="ready" && connection?.execution_enabled; }
  function rowMarkup(row) {
    const config=configs.get(row.campaign_id), id=escape(row.campaign_id);
    const next=nextTransition({...config,enabled:true});
    const nextText = next ? `${next.status==="ACTIVE"?"Ligar":"Pausar"} ${new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(next.at))}` : "Revise os horários";
    return `<tr data-row="${id}"><td class="name">${escape(row.name)}<small class="meta"><span class="state ${row.effective_status==="ACTIVE"?"active":""}">${row.effective_status==="ACTIVE"?"Ativa na última consulta":"Pausada / sem entrega na última consulta"}</span></small></td>
      <td><label class="toggle"><input type="checkbox" data-field="enabled" ${config.enabled?"checked":""} ${activationReady()||(canEdit&&config.enabled)?"":"disabled"} aria-label="Automatizar ${escape(row.name)}"><span>${config.enabled?"Sim":"Não"}</span></label></td>
      <td><input class="time" type="time" step="60" data-field="start_time" value="${escape(config.start_time.slice(0,5))}" aria-label="Ligar ${escape(row.name)}"></td>
      <td><input class="time" type="time" step="60" data-field="end_time" value="${escape(config.end_time.slice(0,5))}" aria-label="Pausar ${escape(row.name)}"></td>
      <td><div class="days">${WEEKDAYS.map((label,i)=>`<label><input type="checkbox" data-day="${i+1}" ${config.weekdays.includes(i+1)?"checked":""} aria-label="${label}: ${escape(row.name)}"><span>${label}</span></label>`).join("")}</div></td>
      <td class="next" data-next>${nextText}<br>${config.enabled && activationReady()?"Horário programado":"Prévia · não executa"}</td>
      <td><button class="button" type="button" data-save="${id}" ${canEdit?"":"disabled"}>${dirty.has(row.campaign_id)||!saved.get(row.campaign_id)?.revision?"Salvar":"Salvo"}</button></td></tr>`;
  }
  function renderRows() {
    const visible=rows.filter(row=>row.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
    root.querySelector("tbody").innerHTML=visible.map(rowMarkup).join("") || `<tr><td colspan="7" class="empty">${query?"Nenhuma campanha encontrada.":"Nenhuma campanha ativa foi encontrada na última consulta desta conta."}</td></tr>`;
  }
  function render() {
    if(closed) return;
    root.querySelector(".body").innerHTML=`<div class="notice ${activationReady()?"ready":""}"><strong>${activationReady()?"Conexão habilitada para agendamento":"Execução automática desabilitada"}</strong><p>${connection?.connection_state==="unavailable"?"A Meta não permite consultar esta conta no momento. O histórico de resultados continua disponível.":!activationReady()?"Aguardando a conexão do aplicativo da Meta e a liberação do administrador. Você pode experimentar os horários abaixo; nenhuma campanha será alterada.":"Selecione as campanhas e salve seus horários. Dias não selecionados permanecem pausados."}</p></div>
      <div class="toolbar"><div><p>${rows.length} ${rows.length===1?"campanha disponível":"campanhas disponíveis"}</p><small class="meta">${connection?.last_sync_at?`Consulta: ${new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(new Date(connection.last_sync_at))} (Brasília)` : "Conexão pendente"}</small></div><div class="actions"><input class="search" data-search type="search" placeholder="Buscar campanha" aria-label="Buscar campanha"><button class="button" data-refresh>Atualizar lista</button>${canEdit?'<button class="button" data-logout>Sair</button>':""}</div></div>
      <div class="table-scroll"><table><thead><tr><th>Campanha</th><th>Automatizar</th><th>Ligar</th><th>Pausar</th><th>Dias da semana</th><th>Próximo horário</th><th>Configuração</th></tr></thead><tbody></tbody></table></div>
      <p class="feedback" data-feedback role="status">${canEdit?"Edite uma linha e clique em Salvar.":"Modo de prévia: alterações nesta tela não são salvas nem executadas."}</p>
      <p class="footnote">Todos os horários são de Brasília, inclusive para contas em dólar. A janela começa e termina no mesmo dia. Desabilitar a automação mantém o estado atual da campanha. Uma pausa manual após a ativação programada é respeitada até a próxima janela.</p>
      ${canEdit?'<details class="login"><summary>Histórico de execuções</summary><div class="log" data-logs>Carregando…</div></details>':`<details class="login"><summary>Entrar para salvar horários</summary><p class="footnote">Acesso exclusivo ao administrador autorizado desta conta. O acesso será configurado na finalização da conexão.</p><form data-login><label>E-mail<input type="email" name="email" required autocomplete="username"></label><label>Senha<input type="password" name="password" required autocomplete="current-password"></label><button class="button primary" type="submit">Entrar</button></form></details>`}`;
    root.querySelector("[data-search]").value=query;
    renderRows();
    if(canEdit) void loadLogs();
  }
  async function loadLogs() {
    try {
      const logs=await request(`rest/v1/automation_runs?account_id=eq.${accountId}&select=campaign_id,desired_status,status,updated_at,error_code&order=updated_at.desc&limit=25`,{authorized:true});
      const node=root.querySelector("[data-logs]");
      if(node) node.innerHTML=logs.length?logs.map(log=>`<p>${escape(rows.find(row=>row.campaign_id===log.campaign_id)?.name || log.campaign_id)} · ${log.desired_status==="ACTIVE"?"Ativar":"Pausar"} · ${escape(({succeeded:"Confirmado",failed:"Falhou",running:"Em execução",skipped:"Ignorado"})[log.status]||log.status)}${log.error_code?` · ${escape(log.error_code)}`:""}</p>`).join(""):"Nenhuma execução registrada.";
    } catch { const node=root.querySelector("[data-logs]");if(node)node.textContent="Não foi possível consultar o histórico."; }
  }
  async function load() {
    if(loading) return;
    loading=true;
    try {
      const [catalog,accounts]=await Promise.all([
        all(`rest/v1/automation_campaigns?account_id=eq.${accountId}&select=account_id,campaign_id,name,status,effective_status,seen_at,present&order=name.asc`),
        request(`rest/v1/automation_accounts?account_id=eq.${accountId}&select=account_id,connection_state,execution_enabled,last_sync_at`)
      ]);
      connection=accounts[0]||null;
      let schedules=[];
      canEdit=false;
      if(session) {
        const members=await request(`rest/v1/automation_members?account_id=eq.${accountId}&select=account_id&limit=1`,{authorized:true});
        canEdit=members.length>0;
        if(canEdit) schedules=await all(`rest/v1/automation_schedules?account_id=eq.${accountId}&select=*&order=campaign_id.asc`,true);
      }
      const scheduled=new Set(schedules.map(item=>item.campaign_id));
      rows=catalog.filter(row=>(row.present && row.effective_status==="ACTIVE") || scheduled.has(row.campaign_id));
      for(const row of rows) {
        const config=schedules.find(item=>item.campaign_id===row.campaign_id)||{...defaults(),account_id:accountId,campaign_id:row.campaign_id};
        saved.set(row.campaign_id,config);
        if(!dirty.has(row.campaign_id)) configs.set(row.campaign_id,{...config,weekdays:[...config.weekdays]});
      }
      render();
    } catch(error) {
      if(!closed) {
        render();
        feedback("Agendamentos temporariamente indisponíveis. Os relatórios continuam funcionando. "+error.message,true);
      }
    } finally {loading=false;}
  }
  root.addEventListener("input",event=>{
    if(event.target.matches("[data-search]")) {query=event.target.value;renderRows();}
  });
  root.addEventListener("change",event=>{
    const tr=event.target.closest("[data-row]");if(!tr)return;
    const id=tr.dataset.row, config=configs.get(id);
    if(event.target.dataset.field) config[event.target.dataset.field]=event.target.type==="checkbox"?event.target.checked:event.target.value;
    else if(event.target.dataset.day) config.weekdays=[...tr.querySelectorAll("[data-day]:checked")].map(input=>Number(input.dataset.day));
    dirty.add(id);
    const errors=validateSchedule(config);
    const next=nextTransition({...config,enabled:true});
    tr.querySelector("[data-next]").textContent=next?`${next.status==="ACTIVE"?"Ligar":"Pausar"} ${new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(new Date(next.at))} · alteração não salva`:"Revise os horários";
    tr.querySelector("[data-save]").textContent="Salvar";
    tr.querySelector(".toggle span").textContent=config.enabled?"Sim":"Não";
    feedback(errors.join(" ") || (canEdit?"Alterações ainda não salvas.":"Prévia atualizada. Nenhum horário foi salvo e nenhuma campanha foi alterada."),errors.length>0);
  });
  root.addEventListener("click",async event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.hasAttribute("data-refresh")) {
      if(dirty.size) {feedback("Salve as alterações antes de atualizar. Fechar a janela descarta a prévia não salva.",true);return;}
      button.disabled=true;
      try {
        if(canEdit && connection?.connection_state==="ready") await request("functions/v1/campaign-scheduler",{method:"POST",body:{operation:"sync",account_id:accountId},authorized:true});
        await load();
      } catch(error) {feedback(error.message,true);} finally {button.disabled=false;}
    }
    if(button.hasAttribute("data-logout")) {
      try {if(session)await request("auth/v1/logout",{method:"POST",authorized:true});}catch{}
      session=null;canEdit=false;dirty.clear();configs.clear();await load();
    }
    if(button.dataset.save && canEdit) {
      const id=button.dataset.save,config=configs.get(id),errors=validateSchedule(config);
      if(errors.length){feedback(errors.join(" "),true);return;}
      if(config.enabled && !activationReady()){feedback("A conexão ainda não foi liberada para execução.",true);return;}
      button.disabled=true;
      try {
        const fields={account_id:accountId,campaign_id:id,enabled:config.enabled,start_time:config.start_time,end_time:config.end_time,weekdays:config.weekdays,timezone:config.timezone};
        const current=saved.get(id);
        // PATCH with a revision predicate prevents an older editor overwriting a new rule.
        const result=current?.revision
          ? await request(`rest/v1/automation_schedules?account_id=eq.${accountId}&campaign_id=eq.${id}&revision=eq.${current.revision}`,{method:"PATCH",body:fields,authorized:true,prefer:"return=representation"})
          : await request("rest/v1/automation_schedules",{method:"POST",body:fields,authorized:true,prefer:"return=representation"});
        if(!result?.length) throw new Error("Este horário mudou em outra sessão. Reabra a janela para conferir a versão atual.");
        configs.set(id,result[0]);saved.set(id,result[0]);dirty.delete(id);button.textContent="Salvo";
        feedback(config.enabled?"Horário salvo. A regra está habilitada.":"Horário salvo com automação desabilitada.");
      }catch(error){feedback(error.message,true);}finally{button.disabled=false;}
    }
  });
  root.addEventListener("submit",async event=>{
    if(!event.target.matches("[data-login]"))return;
    event.preventDefault();const form=event.target,button=form.querySelector("button");button.disabled=true;
    try {
      const response=await request("auth/v1/token?grant_type=password",{method:"POST",body:{email:form.email.value,password:form.password.value}});
      form.password.value="";session={...response,expiresAt:Date.now()+response.expires_in*1000};
      dirty.clear();configs.clear();await load();
      if(!canEdit)feedback("Seu usuário não está autorizado a editar esta conta.",true);
    }catch {form.password.value="";feedback("Não foi possível entrar. Confira o acesso de administrador.",true);}finally{button.disabled=false;}
  });
  await load();
}
