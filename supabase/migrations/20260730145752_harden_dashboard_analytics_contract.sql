create or replace function public.dashboard_summary(di_ini integer, di_fim integer)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select * from v_daily where di between di_ini and di_fim
  ),
  op as (
    select coalesce(sum(spend),0) spend, coalesce(sum(cost),0) cost,
           coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
           count(distinct campaign_id) n_camp
    from base where ciclo_vida='operacional'
  ),
  res as (
    select coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
           count(distinct campaign_id) n_camp
    from base where ciclo_vida='residual'
  ),
  port as (
    select coalesce(sum(spend),0) spend, coalesce(sum(cost),0) cost,
           coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
           count(distinct campaign_id) n_camp
    from base
  )
  select json_build_object(
    'periodo', json_build_object('di_ini',di_ini,'di_fim',di_fim),
    'operacional', json_build_object('spend',round(op.spend,2),'cost',round(op.cost,2),'rev_adj',round(op.rev_adj,2),'profit',round(op.profit,2),'roi',case when op.cost>0 then round(op.profit/op.cost*100,2) else null end,'campanhas',op.n_camp),
    'residual', json_build_object('rev_adj',round(res.rev_adj,2),'profit',round(res.profit,2),'campanhas',res.n_camp),
    'portfolio', json_build_object('spend',round(port.spend,2),'cost',round(port.cost,2),'rev_adj',round(port.rev_adj,2),'profit',round(port.profit,2),'roi',case when port.cost>0 then round(port.profit/port.cost*100,2) else null end,'campanhas',port.n_camp)
  ) from op, res, port;
$function$;

create or replace function public.data_quality_status(di_ini integer, di_fim integer)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select json_build_object(
    'dias_parciais',coalesce((select json_agg(distinct day_label order by day_label) from v_daily where di between di_ini and di_fim and qualidade='parcial'),'[]'::json),
    'inconsistentes',(select count(*) from v_daily where di between di_ini and di_fim and qualidade='inconsistente'),
    'suspeitos',(select count(*) from v_daily where di between di_ini and di_fim and qualidade='suspeito'),
    'total_linhas',(select count(*) from v_daily where di between di_ini and di_fim)
  );
$function$;

create or replace function public.campaign_detail(p_campaign_id integer, di_ini integer, di_fim integer)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with b as (select * from v_daily where campaign_id=p_campaign_id and di between di_ini and di_fim)
  select json_build_object(
    'campaign',(select json_build_object('id',campaign_id,'label',label,'suffix',suffix,'niche',niche,'meta_camp_id',meta_camp_id) from b limit 1),
    'acumulado',(select json_build_object('spend',round(sum(spend),2),'cost',round(sum(cost),2),'rev_adj',round(sum(rev_adj),2),'profit',round(sum(profit),2),'roi',case when sum(cost)>0 then round(sum(profit)/sum(cost)*100,2) end,'dias_gasto',count(*) filter (where spend>0),'novos',sum(novos)) from b),
    'serie',(select json_agg(json_build_object('di',di,'date',date,'spend',spend,'cost',cost,'rev_adj',rev_adj,'profit',profit,'roi',case when cost>0 then round(profit/cost*100,2) end,'novos',novos,'status',status,'ciclo',ciclo_vida,'qualidade',qualidade,'saude',saude) order by di) from b),
    'melhor_dia',(select json_build_object('date',date,'profit',profit,'roi',round(profit/cost*100,2)) from b where cost>0 order by profit desc limit 1),
    'pior_dia',(select json_build_object('date',date,'profit',profit,'roi',round(profit/cost*100,2)) from b where cost>0 order by profit asc limit 1)
  );
$function$;

create or replace function public.operational_alerts(di_ini integer, di_fim integer, min_spend numeric default 150, roi_meta numeric default 20)
returns table(tipo text, prioridade integer, campaign_id integer, label text, impacto numeric, detalhe text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with r as (select * from campaign_ranking(di_ini,di_fim,min_spend,roi_meta,'R-'))
  select 'pausar',1,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% com R$'||spend||' gasto — prejuízo de R$'||abs(profit) from r where recomendacao='pausar' and confianca in ('alta','media')
  union all
  select 'investigar',2,campaign_id,label,round(abs(profit),2),'dados inconsistentes; gasto R$'||spend||' e resultado financeiro de R$'||profit from r where recomendacao='investigar' and spend>0
  union all
  select 'reduzir',3,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% — prejuízo de R$'||abs(profit)||', avaliar corte' from r where recomendacao='reduzir' and confianca in ('alta','media')
  union all
  select 'escalar',4,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% ('||tendencia||') — lucro de R$'||profit||', candidata a escala' from r where recomendacao='escalar'
  order by 2, 5 desc;
$function$;

revoke all on function public.dashboard_summary(integer, integer) from public;
revoke all on function public.data_quality_status(integer, integer) from public;
revoke all on function public.campaign_detail(integer, integer, integer) from public;
revoke all on function public.operational_alerts(integer, integer, numeric, numeric) from public;
grant execute on function public.dashboard_summary(integer, integer) to anon, authenticated, service_role;
grant execute on function public.data_quality_status(integer, integer) to anon, authenticated, service_role;
grant execute on function public.campaign_detail(integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.operational_alerts(integer, integer, numeric, numeric) to anon, authenticated, service_role;
