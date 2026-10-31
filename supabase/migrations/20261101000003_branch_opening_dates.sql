-- Opening figures now say when they apply.
-- opening_date: the opening balance is the balance on this date; earlier records are not counted.
-- opening_pl_sen: profit (+) or loss (-) accumulated up to opening_pl_date.
alter table public.branches
  add column opening_date date,
  add column opening_pl_sen bigint not null default 0,
  add column opening_pl_date date,
  add constraint branches_opening_pl_has_date check (opening_pl_sen = 0 or opening_pl_date is not null);

grant update (opening_date, opening_pl_sen, opening_pl_date) on public.branches to authenticated;

-- These feed every later figure, so closed months freeze them too.
create or replace function public.guard_branch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.opening_balance_sen, new.opening_date, new.opening_pl_sen, new.opening_pl_date)
     is distinct from (old.opening_balance_sen, old.opening_date, old.opening_pl_sen, old.opening_pl_date)
     and exists (select 1 from public.monthly_closings c where c.branch_id = old.id and c.closed_at is not null)
  then
    raise exception 'Nilai permulaan tidak boleh diubah selepas ada bulan ditutup.';
  end if;
  return new;
end $$;

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
join public.branches b on b.id = d.branch_id
where d.txn_date >= coalesce(b.opening_date, d.txn_date);
