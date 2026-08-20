-- The BRL account keeps the 13% Meta Ads tax. The USD account has no
-- additional tax: its financial cost is the original Meta Ads spend.

create temporary table usd_tax_brl_baseline on commit drop as
select
  count(*)::bigint as row_count,
  coalesce(sum(m.spend), 0)::numeric as spend,
  coalesce(sum(m.tax), 0)::numeric as tax,
  coalesce(sum(m.cost), 0)::numeric as cost,
  coalesce(sum(m.rev_adj), 0)::numeric as rev_adj,
  coalesce(sum(m.profit), 0)::numeric as profit
from public.msgs_results m
join public.days d on d.di = m.di
where d.account_id = '1417197509632503';

do $guard$
begin
  if not exists (
    select 1
    from public.dashboard_accounts
    where meta_account_id = '1417197509632503'
      and currency = 'BRL'
      and tax_rate = 0.13
  ) then
    raise exception 'Conta BRL ausente ou com aliquota diferente de 13%%; migracao cancelada';
  end if;

  if not exists (
    select 1
    from public.dashboard_accounts
    where meta_account_id = '2948780535467215'
      and currency = 'USD'
  ) then
    raise exception 'Conta USD esperada nao foi encontrada; migracao cancelada';
  end if;
end
$guard$;

update public.dashboard_accounts
set tax_rate = 0,
    updated_at = now()
where meta_account_id = '2948780535467215'
  and currency = 'USD';

with corrected as (
  select
    m.di,
    m.carro_n,
    round(m.spend::numeric, 2) as cost,
    round((m.rev_adj - m.spend)::numeric, 2) as profit
  from public.msgs_results m
  join public.days d on d.di = m.di
  where d.account_id = '2948780535467215'
)
update public.msgs_results m
set tax = 0,
    cost = corrected.cost,
    profit = corrected.profit,
    roi = case
      when corrected.cost = 0 then null
      else round((corrected.profit / corrected.cost * 100)::numeric, 2)
    end,
    status = case
      when corrected.profit >= 0 then 'lucro'
      when corrected.profit > -10 then 'quase'
      else 'negativo'
    end
from corrected
where m.di = corrected.di
  and m.carro_n = corrected.carro_n;

do $verify$
declare
  baseline usd_tax_brl_baseline%rowtype;
  current_brl usd_tax_brl_baseline%rowtype;
begin
  select * into baseline from usd_tax_brl_baseline;

  select
    count(*)::bigint,
    coalesce(sum(m.spend), 0)::numeric,
    coalesce(sum(m.tax), 0)::numeric,
    coalesce(sum(m.cost), 0)::numeric,
    coalesce(sum(m.rev_adj), 0)::numeric,
    coalesce(sum(m.profit), 0)::numeric
  into current_brl
  from public.msgs_results m
  join public.days d on d.di = m.di
  where d.account_id = '1417197509632503';

  if baseline is distinct from current_brl then
    raise exception 'Dados BRL foram alterados; migracao cancelada';
  end if;

  if exists (
    select 1
    from public.msgs_results m
    join public.days d on d.di = m.di
    where d.account_id = '2948780535467215'
      and (
        m.tax <> 0
        or m.cost <> round(m.spend::numeric, 2)
        or m.profit <> round((m.rev_adj - m.spend)::numeric, 2)
        or m.roi is distinct from case
          when m.spend = 0 then null
          else round(((m.rev_adj - m.spend) / m.spend * 100)::numeric, 2)
        end
      )
  ) then
    raise exception 'Auditoria financeira USD falhou; migracao cancelada';
  end if;
end
$verify$;

comment on column public.dashboard_accounts.tax_rate is
  'Taxa adicional aplicada ao gasto do Meta Ads por conta: BRL 13%; USD 0%.';
