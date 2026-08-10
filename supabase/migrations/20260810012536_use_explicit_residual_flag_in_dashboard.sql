-- Use the ingestion-owned residual flag as the only source of truth.
-- This migration does not alter any financial amount or campaign assignment.

update public.msgs_results m
set residual = true
from public.days d
where d.di = m.di
  and m.residual = false
  and m.cost = 0
  and m.rev > 0
  and not exists (
    select 1
    from public.campaigns c
    where c.typ = 'msgs'
      and c.suffix = m.suffix
      and d.date >= c.ativo_desde
      and (c.ativo_ate is null or d.date <= c.ativo_ate)
  );

create or replace view public.v_daily
with (security_invoker = true)
as
select
  d.di,
  d.date,
  d.label as day_label,
  d.badge,
  c.id as campaign_id,
  c.label,
  c.suffix,
  c.niche,
  c.typ,
  c.meta_camp_id,
  m.carro_n as camp_n,
  m.spend,
  m.tax,
  m.cost,
  m.rev,
  m.rev_adj,
  m.profit,
  m.roi,
  m.broad_rev,
  m.cap_rev,
  m.rpm,
  m.novos,
  m.rpc::numeric as rpc,
  m.broad_imp + m.cap_imp as adx_imp,
  m.fb_imp,
  m.status,
  case
    when m.residual then 'residual'
    when m.cost > 0 or m.rev > 0 then 'operacional'
    else 'inativa'
  end as ciclo_vida,
  case
    when d.badge = 'parcial' then 'parcial'
    when m.cost > 0 and m.fb_imp = 0 then 'inconsistente'
    when m.cost > 0 and m.rev = 0 and m.fb_imp > 500 then 'suspeito'
    else 'completo'
  end as qualidade,
  case
    when m.residual then 'residual_lucro'
    when m.cost = 0 and m.rev > 0 then 'sem_custo'
    when m.cost = 0 then 'sem_dado'
    when m.roi >= 20 then 'saudavel'
    when m.roi >= 0 then 'atencao'
    else 'critico'
  end as saude,
  m.residual
from public.msgs_results m
join public.days d on d.di = m.di
join public.campaigns c on c.camp_n = m.carro_n and c.typ = 'msgs';

comment on column public.v_daily.residual is
  'True somente quando nenhuma campanha do sufixo estava ativa na data; nunca inferir por custo zero.';

grant select on public.v_daily to anon, authenticated, service_role;

create or replace function public.dashboard_summary(di_ini integer, di_fim integer)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select * from public.v_daily where di between di_ini and di_fim
  ),
  op as (
    select
      coalesce(sum(spend),0) spend,
      coalesce(sum(cost),0) cost,
      coalesce(sum(rev_adj),0) rev_adj,
      coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base
    where not residual and (cost > 0 or rev > 0)
  ),
  res as (
    select
      coalesce(sum(rev_adj),0) rev_adj,
      coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base
    where residual
  ),
  port as (
    select
      coalesce(sum(spend),0) spend,
      coalesce(sum(cost),0) cost,
      coalesce(sum(rev_adj),0) rev_adj,
      coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base
  )
  select json_build_object(
    'periodo', json_build_object('di_ini',di_ini,'di_fim',di_fim),
    'operacional', json_build_object(
      'spend',round(op.spend,2),
      'cost',round(op.cost,2),
      'rev_adj',round(op.rev_adj,2),
      'profit',round(op.profit,2),
      'roi',case when op.cost>0 then round(op.profit/op.cost*100,2) else null end,
      'campanhas',op.n_camp
    ),
    'residual', json_build_object(
      'rev_adj',round(res.rev_adj,2),
      'profit',round(res.profit,2),
      'campanhas',res.n_camp
    ),
    'portfolio', json_build_object(
      'spend',round(port.spend,2),
      'cost',round(port.cost,2),
      'rev_adj',round(port.rev_adj,2),
      'profit',round(port.profit,2),
      'roi',case when port.cost>0 then round(port.profit/port.cost*100,2) else null end,
      'campanhas',port.n_camp
    )
  )
  from op, res, port;
$function$;

create or replace function public.campaign_ranking(
  di_ini integer,
  di_fim integer,
  min_spend numeric default 150,
  roi_meta numeric default 20,
  exclude_prefix text default null
)
returns table(
  campaign_id integer,
  label text,
  suffix text,
  niche text,
  spend numeric,
  cost numeric,
  rev_adj numeric,
  profit numeric,
  roi numeric,
  dias_com_gasto integer,
  novos integer,
  roi_1a_metade numeric,
  roi_2a_metade numeric,
  tendencia text,
  confianca text,
  recomendacao text,
  motivo text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select *
    from public.v_daily
    where di between di_ini and di_fim
      and typ = 'msgs'
      and not residual
      and (exclude_prefix is null or label not ilike exclude_prefix || '%')
  ),
  meio as (
    select (di_ini + di_fim) / 2 as m
  ),
  agg as (
    select
      b.campaign_id,
      b.label,
      b.suffix,
      b.niche,
      round(sum(b.spend),2) spend,
      round(sum(b.cost),2) cost,
      round(sum(b.rev_adj),2) rev_adj,
      round(sum(b.profit),2) profit,
      case when sum(b.cost)>0 then round(sum(b.profit)/sum(b.cost)*100,2) end roi,
      count(*) filter (where b.spend>0) dias_com_gasto,
      sum(b.novos) novos,
      count(*) filter (
        where b.qualidade in ('inconsistente','suspeito') and b.spend>0
      ) linhas_ruins,
      case when sum(b.cost) filter (where b.di <= (select m from meio)) > 0
        then round(
          sum(b.profit) filter (where b.di <= (select m from meio))
          / sum(b.cost) filter (where b.di <= (select m from meio)) * 100,
          2
        )
      end roi_1,
      case when sum(b.cost) filter (where b.di > (select m from meio)) > 0
        then round(
          sum(b.profit) filter (where b.di > (select m from meio))
          / sum(b.cost) filter (where b.di > (select m from meio)) * 100,
          2
        )
      end roi_2
    from base b
    group by b.campaign_id,b.label,b.suffix,b.niche
  )
  select
    campaign_id,
    label,
    suffix,
    niche,
    spend,
    cost,
    rev_adj,
    profit,
    roi,
    dias_com_gasto::integer,
    novos::integer,
    roi_1,
    roi_2,
    case
      when roi_1 is null or roi_2 is null then 'indefinida'
      when roi_2 > roi_1 + 5 then 'subindo'
      when roi_2 < roi_1 - 5 then 'caindo'
      else 'estavel'
    end tendencia,
    case
      when spend >= min_spend and dias_com_gasto >= 3 then 'alta'
      when spend >= min_spend/3 then 'media'
      else 'baixa'
    end confianca,
    case
      when linhas_ruins > 0 then 'investigar'
      when spend < min_spend/3 and roi >= roi_meta then 'sinal_promissor'
      when spend >= min_spend and roi >= roi_meta then 'escalar'
      when roi >= 0 then 'manter'
      when roi >= -20 then 'reduzir'
      when roi < -20 then 'pausar'
      else 'acompanhar'
    end recomendacao,
    case
      when linhas_ruins > 0 then 'gasto com impressão/receita inconsistente — checar tracking'
      when spend < min_spend/3 and roi >= roi_meta then 'ROI alto mas amostra pequena (R$'||to_char(spend,'FM999990.00')||')'
      when spend >= min_spend and roi >= roi_meta then 'ROI '||roi||'% com volume — candidata a escala'
      when roi >= 0 then 'positiva, ROI '||roi||'% (meta '||roi_meta||'%)'
      when roi >= -20 then 'prejuízo leve, ROI '||roi||'%'
      when roi < -20 then 'prejuízo alto, ROI '||roi||'%'
      else 'sem custo suficiente para recomendação operacional'
    end motivo
  from agg
  order by profit desc nulls last;
$function$;

create or replace function public.campaign_detail(
  p_campaign_id integer,
  di_ini integer,
  di_fim integer
)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with b as (
    select *
    from public.v_daily
    where campaign_id=p_campaign_id and di between di_ini and di_fim
  )
  select json_build_object(
    'campaign',(
      select json_build_object(
        'id',campaign_id,
        'label',label,
        'suffix',suffix,
        'niche',niche,
        'meta_camp_id',meta_camp_id
      )
      from b
      limit 1
    ),
    'acumulado',(
      select json_build_object(
        'spend',round(sum(spend),2),
        'cost',round(sum(cost),2),
        'rev_adj',round(sum(rev_adj),2),
        'profit',round(sum(profit),2),
        'roi',case when sum(cost)>0 then round(sum(profit)/sum(cost)*100,2) end,
        'dias_gasto',count(*) filter (where spend>0),
        'dias_residuais',count(*) filter (where residual),
        'novos',sum(novos)
      )
      from b
    ),
    'serie',(
      select json_agg(
        json_build_object(
          'di',di,
          'date',date,
          'spend',spend,
          'cost',cost,
          'rev_adj',rev_adj,
          'profit',profit,
          'roi',case when cost>0 then round(profit/cost*100,2) end,
          'novos',novos,
          'status',status,
          'residual',residual,
          'ciclo',ciclo_vida,
          'qualidade',qualidade,
          'saude',saude
        )
        order by di
      )
      from b
    ),
    'melhor_dia',(
      select json_build_object('date',date,'profit',profit,'roi',round(profit/cost*100,2))
      from b
      where cost>0 and not residual
      order by profit desc
      limit 1
    ),
    'pior_dia',(
      select json_build_object('date',date,'profit',profit,'roi',round(profit/cost*100,2))
      from b
      where cost>0 and not residual
      order by profit asc
      limit 1
    )
  );
$function$;

do $check$
begin
  if exists (
    select 1
    from public.msgs_results m
    join public.days d on d.di=m.di
    where m.residual
      and (
        m.cost <> 0
        or m.rev <= 0
        or exists (
          select 1
          from public.campaigns c
          where c.typ='msgs'
            and c.suffix=m.suffix
            and d.date >= c.ativo_desde
            and (c.ativo_ate is null or d.date <= c.ativo_ate)
        )
      )
  ) then
    raise exception 'Residual invariant failed';
  end if;
end
$check$;
