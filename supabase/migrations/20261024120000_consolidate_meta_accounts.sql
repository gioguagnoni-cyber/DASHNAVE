-- Consolidates every physical Meta Ads account into the single public
-- "Campanhas Meta" dashboard while preserving the complete DIZZ 1 USD history.

begin;

do $guard$
begin
  if (select count(*) from public.dashboard_accounts
      where meta_account_id = '2948780535467215') <> 1 then
    raise exception 'A conta-base DIZZ 1 USD esta ausente ou duplicada';
  end if;

  if exists (
    select 1 from public.dashboard_accounts
    where meta_account_id <> '2948780535467215'
  ) then
    raise exception 'A dashboard contem outra conta publica; consolidacao interrompida';
  end if;
end
$guard$;

update public.dashboard_accounts
set slug = 'campanhas-meta',
    source_name = 'Campanhas Meta',
    display_name = 'Campanhas Meta',
    meta_business_id = null,
    meta_business_name = 'Multiplas contas Meta',
    updated_at = now()
where meta_account_id = '2948780535467215';

comment on column public.dashboard_accounts.meta_account_id is
  'Identificador interno do agrupador da dashboard. As contas Meta fisicas ficam em meta_source_accounts.';

create table if not exists public.meta_source_accounts (
  meta_account_id text primary key,
  dashboard_account_id text not null references public.dashboard_accounts(meta_account_id),
  source_name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text,
  meta_business_id text,
  meta_business_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.meta_source_accounts is
  'Contas Meta Ads fisicas que alimentam o agrupador unico Campanhas Meta.';

create index if not exists meta_source_accounts_dashboard_idx
  on public.meta_source_accounts (dashboard_account_id, enabled);

alter table public.meta_source_accounts enable row level security;

drop policy if exists public_read_meta_source_accounts on public.meta_source_accounts;
create policy public_read_meta_source_accounts
on public.meta_source_accounts
for select
to anon, authenticated
using (true);

revoke all on public.meta_source_accounts from public;
grant select on public.meta_source_accounts to anon, authenticated, service_role;
grant insert, update, delete on public.meta_source_accounts to service_role;

insert into public.meta_source_accounts (
  meta_account_id, dashboard_account_id, source_name, currency, timezone,
  meta_business_id, meta_business_name, enabled
) values
  (
    '2948780535467215', '2948780535467215', 'DIZZ 1 USD', 'USD',
    'America/Los_Angeles', '546075581104536', 'Bali Web Sites', false
  ),
  (
    '1136295338740996', '2948780535467215', 'DIZZ 2 USD', 'USD',
    'America/Los_Angeles', '3329126620729562', 'Up Book', true
  ),
  (
    '1696662518753370', '2948780535467215', 'DIZZ 3 USD', 'USD',
    null, '3329126620729562', 'Up Book', true
  )
on conflict (meta_account_id) do update set
  dashboard_account_id = excluded.dashboard_account_id,
  source_name = excluded.source_name,
  currency = excluded.currency,
  timezone = excluded.timezone,
  meta_business_id = excluded.meta_business_id,
  meta_business_name = excluded.meta_business_name,
  enabled = excluded.enabled,
  updated_at = now();

alter table public.campaigns
  add column if not exists source_meta_account_id text;

update public.campaigns
set source_meta_account_id = '2948780535467215'
where account_id = '2948780535467215'
  and source_meta_account_id is null;

alter table public.campaigns
  alter column source_meta_account_id set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_source_meta_account_id_fkey'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_source_meta_account_id_fkey
      foreign key (source_meta_account_id)
      references public.meta_source_accounts(meta_account_id);
  end if;
end
$constraints$;

create index if not exists campaigns_source_meta_account_idx
  on public.campaigns (source_meta_account_id, ativo_desde, ativo_ate);

alter table private.import_batches
  add column if not exists source_meta_account_ids text[];

update private.import_batches
set source_meta_account_ids = array['2948780535467215']::text[]
where source_meta_account_ids is null;

alter table private.import_batches
  alter column source_meta_account_ids set not null;

-- The eight pages moved to DIZZ 2 USD on 23/10. Closing only the ownership
-- interval keeps every historical financial row unchanged.
update public.campaigns
set ativo_ate = date '2026-10-22'
where account_id = '2948780535467215'
  and source_meta_account_id = '2948780535467215'
  and typ = 'msgs'
  and ativo_ate is null
  and suffix in ('90304','11940','70810','14754','59940','26635','73905','59937');

with incoming(label, suffix, meta_camp_id) as (
  values
    ('01-IMG-SPAIN-ES-RELAC-90304-V01','90304','120254333936620721'),
    ('02-IMG-SPAIN-ES-RELAC-11940-V01','11940','120254333767390721'),
    ('03-IMG-SPAIN-ES-RELAC-70810-V01','70810','120254334142590721'),
    ('04-IMG-SPAIN-ES-RELAC-14754-V01','14754','120254334596640721'),
    ('05-IMG-SPAIN-ES-RELAC-59940-V01','59940','120254334678580721'),
    ('06-IMG-SPAIN-ES-RELAC-26635-V01','26635','120254334703850721'),
    ('07-IMG-SPAIN-ES-RELAC-73905-V01','73905','120254334908620721'),
    ('08-IMG-SPAIN-ES-RELAC-59937-V01','59937','120254334951150721')
), base as (
  select coalesce(max(camp_n),0) as max_camp_n from public.campaigns
), prepared as (
  select
    i.*,
    base.max_camp_n + row_number() over (order by i.label) as camp_n,
    coalesce(previous.niche, 'relacionamento') as niche
  from incoming i
  cross join base
  left join lateral (
    select c.niche
    from public.campaigns c
    where c.account_id = '2948780535467215'
      and c.suffix = i.suffix
      and c.typ = 'msgs'
    order by c.ativo_desde desc nulls last, c.camp_n desc
    limit 1
  ) previous on true
)
insert into public.campaigns (
  label, typ, camp_n, suffix, niche, meta_camp_id,
  ativo_desde, ativo_ate, grupo_operacao, account_id, source_meta_account_id
)
select
  label, 'msgs', camp_n, suffix, niche, meta_camp_id,
  date '2026-10-23', null, label, '2948780535467215', '1136295338740996'
from prepared
on conflict (account_id, label) do update set
  meta_camp_id = excluded.meta_camp_id,
  suffix = excluded.suffix,
  ativo_desde = excluded.ativo_desde,
  ativo_ate = excluded.ativo_ate,
  grupo_operacao = excluded.grupo_operacao,
  source_meta_account_id = excluded.source_meta_account_id;

create or replace view public.v_daily as
select
  d.di,d.date,d.label as day_label,d.badge,
  c.id as campaign_id,c.label,c.suffix,c.niche,c.typ,c.meta_camp_id,
  m.carro_n as camp_n,m.spend,m.tax,m.cost,m.rev,m.rev_adj,m.profit,m.roi,
  m.broad_rev,m.cap_rev,m.rpm,m.novos,m.rpc::numeric as rpc,
  m.broad_imp + m.cap_imp as adx_imp,m.fb_imp,m.status,
  case when m.residual then 'residual'
       when m.cost > 0 or m.rev > 0 then 'operacional'
       else 'inativa' end as ciclo_vida,
  case when d.badge = 'parcial' then 'parcial'
       when m.cost > 0 and m.fb_imp = 0 then 'inconsistente'
       when m.cost > 0 and m.rev = 0 and m.fb_imp > 500 then 'suspeito'
       else 'completo' end as qualidade,
  case when m.residual then 'residual_lucro'
       when m.cost = 0 and m.rev > 0 then 'sem_custo'
       when m.cost = 0 then 'sem_dado'
       when m.roi >= 20 then 'saudavel'
       when m.roi >= 0 then 'atencao'
       else 'critico' end as saude,
  m.residual,
  a.meta_account_id as account_id,a.slug as account_slug,a.display_name as account_name,
  a.currency,a.timezone,a.tax_rate,a.rev_share_rate,
  c.source_meta_account_id,
  msa.source_name as meta_source_account_name
from public.msgs_results m
join public.days d on d.di = m.di
join public.campaigns c
  on c.camp_n = m.carro_n and c.typ = 'msgs' and c.account_id = d.account_id
join public.dashboard_accounts a on a.meta_account_id = d.account_id
join public.meta_source_accounts msa on msa.meta_account_id = c.source_meta_account_id;

alter view public.v_daily set (security_invoker = true);

comment on column public.v_daily.source_meta_account_id is
  'ID da conta Meta Ads fisica que originou a campanha.';
comment on column public.v_daily.meta_source_account_name is
  'Nome da conta Meta Ads fisica que originou a campanha.';

commit;
