-- Adds "Lain-lain kos" as its own transaction type, deducted from the balance like a cost.
alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('capital_in', 'purchase', 'cost', 'other_cost', 'capital_return', 'capital_pass'));

-- New columns must come last for CREATE OR REPLACE VIEW.
create or replace view public.branch_daily with (security_invoker = true) as
select
  d.branch_id,
  d.txn_date,
  public.accounting_period(d.txn_date) as period,
  d.capital_in_sen,
  d.purchases_sen,
  d.costs_sen,
  d.returned_sen,
  d.passed_sen,
  (b.opening_balance_sen + sum(d.capital_in_sen - d.purchases_sen - d.costs_sen - d.other_costs_sen - d.returned_sen - d.passed_sen)
    over (partition by d.branch_id order by d.txn_date))::bigint as balance_sen,
  d.other_costs_sen
from (
  select
    branch_id,
    txn_date,
    coalesce(sum(amount_sen) filter (where kind = 'capital_in'), 0)::bigint as capital_in_sen,
    coalesce(sum(amount_sen) filter (where kind = 'purchase'), 0)::bigint as purchases_sen,
    coalesce(sum(amount_sen) filter (where kind = 'cost'), 0)::bigint as costs_sen,
    coalesce(sum(amount_sen) filter (where kind = 'other_cost'), 0)::bigint as other_costs_sen,
    coalesce(sum(amount_sen) filter (where kind = 'capital_return'), 0)::bigint as returned_sen,
    coalesce(sum(amount_sen) filter (where kind = 'capital_pass'), 0)::bigint as passed_sen
  from public.transactions
  where voided_at is null
  group by branch_id, txn_date
) d
join public.branches b on b.id = d.branch_id;
