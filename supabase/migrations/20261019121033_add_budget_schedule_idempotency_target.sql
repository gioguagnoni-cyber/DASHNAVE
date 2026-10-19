alter table public.automation_budget_schedules
  add column if not exists resolved_budget_cents bigint;

alter table public.automation_budget_schedules
  add constraint automation_resolved_budget_positive
  check (resolved_budget_cents is null or resolved_budget_cents >= 100);

comment on column public.automation_budget_schedules.resolved_budget_cents is
  'Alvo congelado antes da chamada ao Meta, garantindo idempotencia em retentativas.';
