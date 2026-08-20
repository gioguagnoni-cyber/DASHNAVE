-- Add account and currency isolation without recalculating historical financial data.
-- All existing rows are assigned to the original BRL account.

create temporary table dashnave_financial_baseline as
select
  count(*)::bigint as result_count,
  round(sum(spend),2) as spend,
  round(sum(tax),2) as tax,
  round(sum(cost),2) as cost,
  round(sum(rev),2) as rev,
  round(sum(rev_adj),2) as rev_adj,
  round(sum(profit),2) as profit,
  md5(string_agg(
    concat_ws('|', di, carro_n, spend, tax, cost, broad_rev, cap_rev, rev, rev_adj,
      broad_adj, cap_adj, profit, coalesce(roi::text,'NULL'), rpm, broad_imp, cap_imp,
      fb_imp, novos, rpc, status, residual),
    E'\n' order by di, carro_n
  )) as financial_md5
from public.msgs_results;

create table if not exists public.dashboard_accounts (
  meta_account_id text primary key,
  slug text not null unique,
  source_name text not null,
  display_name text not null,
  meta_business_id text,
  meta_business_name text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null,
  tax_rate numeric(7,6) not null default 0.13 check (tax_rate >= 0 and tax_rate < 1),
  rev_share_rate numeric(7,6) not null default 0.10 check (rev_share_rate >= 0 and rev_share_rate < 1),
  alert_min_spend numeric(12,2) not null default 150 check (alert_min_spend >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dashboard_accounts is
  'Contas Meta Ads exibidas separadamente na DASHNAVE; moeda e fuso são propriedades da conta.';
comment on column public.dashboard_accounts.meta_account_id is
  'ID numérico da conta de anúncios, armazenado como texto para preservar precisão.';

alter table public.dashboard_accounts enable row level security;

drop policy if exists public_read_enabled_dashboard_accounts on public.dashboard_accounts;
create policy public_read_enabled_dashboard_accounts
on public.dashboard_accounts
for select
to anon, authenticated
using (enabled);

revoke all on public.dashboard_accounts from public;
grant select on public.dashboard_accounts to anon, authenticated, service_role;

insert into public.dashboard_accounts (
  meta_account_id, slug, source_name, display_name,
  meta_business_id, meta_business_name, currency, timezone,
  tax_rate, rev_share_rate, alert_min_spend, enabled
) values
  (
    '1417197509632503', 'dizz-1-wave-brl', 'DIZZ 1 WAVE', 'DIZZ 1 WAVE · BRL',
    '453071043776583', 'Renan Wave', 'BRL', 'America/Sao_Paulo',
    0.13, 0.10, 150, true
  ),
  (
    '2948780535467215', 'dizz-1-usd', 'DIZZ 1 USD', 'DIZZ 1 USD · USD',
    '546075581104536', 'Bali Web Sites', 'USD', 'America/Los_Angeles',
    0.13, 0.10, 150, true
  )
on conflict (meta_account_id) do update set
  slug = excluded.slug,
  source_name = excluded.source_name,
  display_name = excluded.display_name,
  meta_business_id = excluded.meta_business_id,
  meta_business_name = excluded.meta_business_name,
  currency = excluded.currency,
  timezone = excluded.timezone,
  tax_rate = excluded.tax_rate,
  rev_share_rate = excluded.rev_share_rate,
  alert_min_spend = excluded.alert_min_spend,
  enabled = excluded.enabled,
  updated_at = now();

alter table public.campaigns add column if not exists account_id text;
alter table public.days add column if not exists account_id text;

update public.campaigns
set account_id = '1417197509632503'
where account_id is null;

update public.days
set account_id = '1417197509632503'
where account_id is null;

alter table public.campaigns alter column account_id set not null;
alter table public.days alter column account_id set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_account_id_fkey'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_account_id_fkey
      foreign key (account_id)
      references public.dashboard_accounts(meta_account_id)
      not valid;
    alter table public.campaigns validate constraint campaigns_account_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'days_account_id_fkey'
      and conrelid = 'public.days'::regclass
  ) then
    alter table public.days
      add constraint days_account_id_fkey
      foreign key (account_id)
      references public.dashboard_accounts(meta_account_id)
      not valid;
    alter table public.days validate constraint days_account_id_fkey;
  end if;
end
$constraints$;

alter table public.campaigns drop constraint if exists campaigns_label_key;

create unique index if not exists campaigns_account_label_idx
  on public.campaigns (account_id, label);

create unique index if not exists campaigns_account_meta_id_idx
  on public.campaigns (account_id, meta_camp_id)
  where meta_camp_id is not null;

create index if not exists campaigns_account_id_idx
  on public.campaigns (account_id);

create index if not exists campaigns_msgs_account_suffix_lifecycle_idx
  on public.campaigns (account_id, suffix, ativo_desde, ativo_ate, camp_n)
  where typ = 'msgs';

create unique index if not exists days_account_date_idx
  on public.days (account_id, date);

create index if not exists days_account_id_idx
  on public.days (account_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.import_batches (
  id bigint generated always as identity primary key,
  batch_key text not null unique,
  account_id text not null references public.dashboard_accounts(meta_account_id),
  reporting_date date not null,
  source_mode text not null check (source_mode in ('meta_file', 'meta_connector_snapshot')),
  is_partial boolean not null default false,
  source_currency text not null check (source_currency ~ '^[A-Z]{3}$'),
  meta_source_name text,
  gam_source_name text not null,
  meta_sha256 text,
  gam_sha256 text not null,
  status text not null default 'prepared' check (status in ('prepared','applied','rejected','failed')),
  totals jsonb not null default '{}'::jsonb,
  audit jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists import_batches_account_date_idx
  on private.import_batches (account_id, reporting_date desc);

revoke all on private.import_batches from public, anon, authenticated;

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
  m.residual,
  a.meta_account_id as account_id,
  a.slug as account_slug,
  a.display_name as account_name,
  a.currency,
  a.timezone,
  a.tax_rate,
  a.rev_share_rate
from public.msgs_results m
join public.days d on d.di = m.di
join public.campaigns c
  on c.camp_n = m.carro_n
 and c.typ = 'msgs'
 and c.account_id = d.account_id
join public.dashboard_accounts a
  on a.meta_account_id = d.account_id;

comment on column public.v_daily.account_id is
  'Conta Meta Ads proprietária da data e da campanha; obrigatório em todos os filtros.';
comment on column public.v_daily.currency is
  'Moeda nativa da conta. Valores de contas diferentes nunca devem ser somados.';
comment on column public.v_daily.residual is
  'True somente quando nenhuma campanha do sufixo estava ativa na data; nunca inferir por custo zero.';

grant select on public.v_daily to anon, authenticated, service_role;

create or replace view public.v_campaign_roi_history
with (security_invoker = true)
as
select
  d.di,
  c.label,
  mr.roi,
  d.account_id
from public.msgs_results mr
join public.days d on d.di = mr.di
join public.campaigns c
  on c.camp_n = mr.carro_n
 and c.typ = 'msgs'
 and c.account_id = d.account_id
order by d.account_id, c.label, d.di;

grant select on public.v_campaign_roi_history to anon, authenticated, service_role;

create or replace function public.enforce_msgs_result_attribution()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  result_date date;
  result_account_id text;
  owner_account_id text;
  owner_suffix text;
  active_groups integer;
  expected_owner integer;
begin
  select d.date, d.account_id
    into result_date, result_account_id
  from public.days d
  where d.di = new.di;

  if result_date is null or result_account_id is null then
    raise exception 'Dia % não cadastrado para validar a atribuição', new.di;
  end if;

  select c.account_id, c.suffix
    into owner_account_id, owner_suffix
  from public.campaigns c
  where c.typ = 'msgs' and c.camp_n = new.carro_n;

  if owner_account_id is null then
    raise exception 'Campanha % não cadastrada para validar a atribuição', new.carro_n;
  end if;

  if owner_account_id <> result_account_id then
    raise exception 'Campanha % pertence à conta %, mas o dia % pertence à conta %',
      new.carro_n, owner_account_id, new.di, result_account_id;
  end if;

  if owner_suffix is distinct from new.suffix then
    raise exception 'Sufixo % não corresponde ao cadastro da campanha % (%)',
      new.suffix, new.carro_n, owner_suffix;
  end if;

  select count(distinct coalesce(nullif(c.grupo_operacao,''), c.label))
    into active_groups
  from public.campaigns c
  where c.typ = 'msgs'
    and c.account_id = result_account_id
    and c.suffix = new.suffix
    and result_date >= c.ativo_desde
    and (c.ativo_ate is null or result_date <= c.ativo_ate);

  if new.residual then
    if new.spend <> 0 or new.cost <> 0 or new.rev <= 0 then
      raise exception 'Linha residual exige gasto/custo zero e receita positiva (conta %, sufixo %, data %)',
        result_account_id, new.suffix, result_date;
    end if;

    if active_groups > 0 then
      raise exception 'Receita da conta %, sufixo % em % deve pertencer à campanha ativa',
        result_account_id, new.suffix, result_date;
    end if;

    select c.camp_n into expected_owner
    from public.campaigns c
    where c.typ = 'msgs'
      and c.account_id = result_account_id
      and c.suffix = new.suffix
      and c.ativo_ate is not null
      and c.ativo_ate < result_date
    order by c.ativo_ate desc, c.camp_n desc
    limit 1;

    if expected_owner is null or expected_owner <> new.carro_n then
      raise exception 'Receita residual da conta %, sufixo % em % deve ser atribuída à última campanha ativa (%)',
        result_account_id, new.suffix, result_date, expected_owner;
    end if;

    return new;
  end if;

  if new.cost > 0 or new.rev > 0 then
    if active_groups = 0 then
      raise exception 'Nenhuma campanha ativa cadastrada para conta %, sufixo % em %',
        result_account_id, new.suffix, result_date;
    end if;

    if active_groups > 1 then
      raise exception 'Mais de uma operação ativa usa conta %, sufixo % em %',
        result_account_id, new.suffix, result_date;
    end if;

    select c.camp_n into expected_owner
    from public.campaigns c
    where c.typ = 'msgs'
      and c.account_id = result_account_id
      and c.suffix = new.suffix
      and result_date >= c.ativo_desde
      and (c.ativo_ate is null or result_date <= c.ativo_ate)
    order by (c.ativo_ate is null) desc, c.ativo_desde asc, c.camp_n asc
    limit 1;

    if expected_owner <> new.carro_n then
      raise exception 'Conta %, sufixo % em % deve ser atribuído à campanha ativa %, não à campanha %',
        result_account_id, new.suffix, result_date, expected_owner, new.carro_n;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_msgs_result_attribution() from public, anon, authenticated;

drop trigger if exists msgs_results_attribution_guard on public.msgs_results;
create trigger msgs_results_attribution_guard
before insert or update of di, carro_n, suffix, spend, cost, rev, residual
on public.msgs_results
for each row
execute function public.enforce_msgs_result_attribution();

create or replace function public.dashboard_summary_account(
  p_account_id text,
  di_ini integer,
  di_fim integer
)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select * from public.v_daily
    where account_id = p_account_id and di between di_ini and di_fim
  ),
  op as (
    select coalesce(sum(spend),0) spend, coalesce(sum(cost),0) cost,
      coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base where not residual and (cost > 0 or rev > 0)
  ),
  res as (
    select coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base where residual
  ),
  port as (
    select coalesce(sum(spend),0) spend, coalesce(sum(cost),0) cost,
      coalesce(sum(rev_adj),0) rev_adj, coalesce(sum(profit),0) profit,
      count(distinct campaign_id) n_camp
    from base
  )
  select json_build_object(
    'account_id',p_account_id,
    'periodo',json_build_object('di_ini',di_ini,'di_fim',di_fim),
    'operacional',json_build_object('spend',round(op.spend,2),'cost',round(op.cost,2),'rev_adj',round(op.rev_adj,2),'profit',round(op.profit,2),'roi',case when op.cost>0 then round(op.profit/op.cost*100,2) end,'campanhas',op.n_camp),
    'residual',json_build_object('rev_adj',round(res.rev_adj,2),'profit',round(res.profit,2),'campanhas',res.n_camp),
    'portfolio',json_build_object('spend',round(port.spend,2),'cost',round(port.cost,2),'rev_adj',round(port.rev_adj,2),'profit',round(port.profit,2),'roi',case when port.cost>0 then round(port.profit/port.cost*100,2) end,'campanhas',port.n_camp)
  ) from op,res,port;
$function$;

create or replace function public.data_quality_status_account(
  p_account_id text,
  di_ini integer,
  di_fim integer
)
returns json
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select json_build_object(
    'dias_parciais',coalesce((select json_agg(distinct day_label order by day_label) from public.v_daily where account_id=p_account_id and di between di_ini and di_fim and qualidade='parcial'),'[]'::json),
    'inconsistentes',(select count(*) from public.v_daily where account_id=p_account_id and di between di_ini and di_fim and qualidade='inconsistente'),
    'suspeitos',(select count(*) from public.v_daily where account_id=p_account_id and di between di_ini and di_fim and qualidade='suspeito'),
    'total_linhas',(select count(*) from public.v_daily where account_id=p_account_id and di between di_ini and di_fim)
  );
$function$;

create or replace function public.campaign_ranking_account(
  p_account_id text,
  di_ini integer,
  di_fim integer,
  min_spend numeric default 150,
  roi_meta numeric default 20,
  exclude_prefix text default null
)
returns table(
  campaign_id integer, label text, suffix text, niche text,
  spend numeric, cost numeric, rev_adj numeric, profit numeric, roi numeric,
  dias_com_gasto integer, novos integer, roi_1a_metade numeric,
  roi_2a_metade numeric, tendencia text, confianca text,
  recomendacao text, motivo text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select * from public.v_daily
    where account_id = p_account_id
      and di between di_ini and di_fim
      and typ = 'msgs'
      and not residual
      and (exclude_prefix is null or label not ilike exclude_prefix || '%')
  ),
  meio as (select (di_ini + di_fim) / 2 as m),
  agg as (
    select b.campaign_id,b.label,b.suffix,b.niche,
      round(sum(b.spend),2) spend,
      round(sum(b.cost),2) cost,
      round(sum(b.rev_adj),2) rev_adj,
      round(sum(b.profit),2) profit,
      case when sum(b.cost)>0 then round(sum(b.profit)/sum(b.cost)*100,2) end roi,
      count(*) filter (where b.spend>0) dias_com_gasto,
      sum(b.novos) novos,
      count(*) filter (where b.qualidade in ('inconsistente','suspeito') and b.spend>0) linhas_ruins,
      case when sum(b.cost) filter (where b.di <= (select m from meio)) > 0
        then round(sum(b.profit) filter (where b.di <= (select m from meio)) / sum(b.cost) filter (where b.di <= (select m from meio))*100,2) end roi_1,
      case when sum(b.cost) filter (where b.di > (select m from meio)) > 0
        then round(sum(b.profit) filter (where b.di > (select m from meio)) / sum(b.cost) filter (where b.di > (select m from meio))*100,2) end roi_2
    from base b
    group by b.campaign_id,b.label,b.suffix,b.niche
  )
  select campaign_id,label,suffix,niche,spend,cost,rev_adj,profit,roi,
    dias_com_gasto::integer,novos::integer,roi_1,roi_2,
    case when roi_1 is null or roi_2 is null then 'indefinida'
      when roi_2 > roi_1 + 5 then 'subindo'
      when roi_2 < roi_1 - 5 then 'caindo'
      else 'estavel' end tendencia,
    case when spend >= min_spend and dias_com_gasto >= 3 then 'alta'
      when spend >= min_spend/3 then 'media'
      else 'baixa' end confianca,
    case when linhas_ruins > 0 then 'investigar'
      when spend < min_spend/3 and roi >= roi_meta then 'sinal_promissor'
      when spend >= min_spend and roi >= roi_meta then 'escalar'
      when roi >= 0 then 'manter'
      when roi >= -20 then 'reduzir'
      when roi < -20 then 'pausar'
      else 'acompanhar' end recomendacao,
    case when linhas_ruins > 0 then 'gasto com impressão/receita inconsistente — checar tracking'
      when spend < min_spend/3 and roi >= roi_meta then 'ROI alto mas amostra pequena ('||to_char(spend,'FM999990.00')||')'
      when spend >= min_spend and roi >= roi_meta then 'ROI '||roi||'% com volume — candidata a escala'
      when roi >= 0 then 'positiva, ROI '||roi||'% (meta '||roi_meta||'%)'
      when roi >= -20 then 'prejuízo leve, ROI '||roi||'%'
      when roi < -20 then 'prejuízo alto, ROI '||roi||'%'
      else 'sem custo suficiente para recomendação operacional' end motivo
  from agg
  order by profit desc nulls last;
$function$;

create or replace function public.operational_alerts_account(
  p_account_id text,
  di_ini integer,
  di_fim integer,
  min_spend numeric default 150,
  roi_meta numeric default 20
)
returns table(tipo text, prioridade integer, campaign_id integer, label text, impacto numeric, detalhe text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with account as (
    select currency from public.dashboard_accounts where meta_account_id=p_account_id
  ),
  r as (
    select * from public.campaign_ranking_account(p_account_id,di_ini,di_fim,min_spend,roi_meta,'R-')
  )
  select 'pausar',1,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% com '||(select currency from account)||' '||spend||' gasto — prejuízo de '||(select currency from account)||' '||abs(profit) from r where recomendacao='pausar' and confianca in ('alta','media')
  union all
  select 'investigar',2,campaign_id,label,round(abs(profit),2),'dados inconsistentes; gasto '||(select currency from account)||' '||spend||' e resultado de '||(select currency from account)||' '||profit from r where recomendacao='investigar' and spend>0
  union all
  select 'reduzir',3,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% — prejuízo de '||(select currency from account)||' '||abs(profit)||', avaliar corte' from r where recomendacao='reduzir' and confianca in ('alta','media')
  union all
  select 'escalar',4,campaign_id,label,round(abs(profit),2),'ROI '||roi||'% ('||tendencia||') — lucro de '||(select currency from account)||' '||profit||', candidata a escala' from r where recomendacao='escalar'
  order by 2,5 desc;
$function$;

revoke all on function public.dashboard_summary_account(text,integer,integer) from public;
revoke all on function public.data_quality_status_account(text,integer,integer) from public;
revoke all on function public.campaign_ranking_account(text,integer,integer,numeric,numeric,text) from public;
revoke all on function public.operational_alerts_account(text,integer,integer,numeric,numeric) from public;

grant execute on function public.dashboard_summary_account(text,integer,integer) to anon, authenticated, service_role;
grant execute on function public.data_quality_status_account(text,integer,integer) to anon, authenticated, service_role;
grant execute on function public.campaign_ranking_account(text,integer,integer,numeric,numeric,text) to anon, authenticated, service_role;
grant execute on function public.operational_alerts_account(text,integer,integer,numeric,numeric) to anon, authenticated, service_role;

do $verify$
declare
  before_row dashnave_financial_baseline%rowtype;
  after_count bigint;
  after_spend numeric;
  after_tax numeric;
  after_cost numeric;
  after_rev numeric;
  after_rev_adj numeric;
  after_profit numeric;
  after_md5 text;
begin
  select * into before_row from dashnave_financial_baseline;

  select count(*), round(sum(spend),2), round(sum(tax),2), round(sum(cost),2),
    round(sum(rev),2), round(sum(rev_adj),2), round(sum(profit),2),
    md5(string_agg(
      concat_ws('|', di, carro_n, spend, tax, cost, broad_rev, cap_rev, rev, rev_adj,
        broad_adj, cap_adj, profit, coalesce(roi::text,'NULL'), rpm, broad_imp, cap_imp,
        fb_imp, novos, rpc, status, residual),
      E'\n' order by di, carro_n
    ))
  into after_count,after_spend,after_tax,after_cost,after_rev,after_rev_adj,after_profit,after_md5
  from public.msgs_results;

  if before_row.result_count <> after_count
    or before_row.spend <> after_spend
    or before_row.tax <> after_tax
    or before_row.cost <> after_cost
    or before_row.rev <> after_rev
    or before_row.rev_adj <> after_rev_adj
    or before_row.profit <> after_profit
    or before_row.financial_md5 <> after_md5 then
    raise exception 'A migração multi-conta alterou valores históricos e foi bloqueada';
  end if;

  if (select count(*) from public.campaigns where account_id is null) > 0
    or (select count(*) from public.days where account_id is null) > 0 then
    raise exception 'Existem campanhas ou datas sem conta após o backfill';
  end if;

  if (select count(*) from public.v_daily) <> after_count then
    raise exception 'A view multi-conta perdeu ou duplicou linhas históricas';
  end if;
end
$verify$;

drop table dashnave_financial_baseline;
