-- All money is stored as integer sen.

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  opening_balance_sen bigint not null default 0 check (opening_balance_sen >= 0),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.branch_members (
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);
create index branch_members_user_idx on public.branch_members (user_id);

-- `id` is generated on the client so a retried offline save cannot create a duplicate.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  txn_date date not null,
  kind text not null check (kind in ('capital_in', 'purchase', 'cost', 'capital_return', 'capital_pass')),
  amount_sen bigint not null check (amount_sen > 0 and amount_sen <= 100000000000),
  description text not null default '' check (length(description) <= 200),
  counterparty text not null default '' check (length(counterparty) <= 200),
  voided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_branch_date_idx on public.transactions (branch_id, txn_date) where voided_at is null;

create table public.monthly_closings (
  branch_id uuid not null references public.branches(id) on delete restrict,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  gross_profit_sen bigint not null default 0 check (gross_profit_sen >= 0),
  notes text not null default '' check (length(notes) <= 1000),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (branch_id, period)
);

create table public.opex_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  period text not null,
  label text not null check (length(trim(label)) between 1 and 120),
  amount_sen bigint not null check (amount_sen >= 0),
  foreign key (branch_id, period) references public.monthly_closings(branch_id, period) on delete cascade
);
create index opex_items_month_idx on public.opex_items (branch_id, period);

create table public.audit_log (
  id bigint generated always as identity primary key,
  branch_id uuid,
  table_name text not null,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index audit_log_branch_idx on public.audit_log (branch_id, at desc);

-- Accounting month runs from the 25th to the 24th: 25 Sep - 24 Oct is period 2026-10.
create function public.accounting_period(d date) returns text
language sql immutable as $$
  select to_char(case when extract(day from d) >= 25 then d + interval '1 month' else d end, 'YYYY-MM')
$$;

create function public.is_branch_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.branch_members m where m.branch_id = b and m.user_id = auth.uid())
$$;

create function public.is_branch_owner(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.branch_members m where m.branch_id = b and m.user_id = auth.uid() and m.role = 'owner')
$$;

create function public.is_month_closed(b uuid, p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.monthly_closings c where c.branch_id = b and c.period = p and c.closed_at is not null)
$$;

-- Guards every transaction write: closed months are locked and ownership fields stay fixed.
create function public.guard_transaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.branch_id <> old.branch_id then
      raise exception 'Rekod tidak boleh dipindah ke cawangan lain.';
    end if;
    if public.is_month_closed(old.branch_id, public.accounting_period(old.txn_date)) then
      raise exception 'Bulan ini telah ditutup. Buka semula dahulu.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  if public.is_month_closed(new.branch_id, public.accounting_period(new.txn_date)) then
    raise exception 'Bulan ini telah ditutup. Buka semula dahulu.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger transactions_guard before insert or update on public.transactions
for each row execute function public.guard_transaction();

-- Opening balance feeds every later balance, so closed months must freeze it.
create function public.guard_branch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opening_balance_sen <> old.opening_balance_sen and exists (
    select 1 from public.monthly_closings c where c.branch_id = old.id and c.closed_at is not null
  ) then
    raise exception 'Modal permulaan tidak boleh diubah selepas ada bulan ditutup.';
  end if;
  return new;
end $$;
create trigger branches_guard before update on public.branches
for each row execute function public.guard_branch();

create function public.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_json jsonb := coalesce(new_json, old_json);
begin
  insert into public.audit_log (branch_id, table_name, action, old_row, new_row)
  values (coalesce((row_json ->> 'branch_id')::uuid, (row_json ->> 'id')::uuid), tg_table_name, tg_op, old_json, new_json);
  return null;
end $$;
create trigger audit_branches after insert or update or delete on public.branches for each row execute function public.write_audit();
create trigger audit_members after insert or update or delete on public.branch_members for each row execute function public.write_audit();
create trigger audit_transactions after insert or update or delete on public.transactions for each row execute function public.write_audit();
create trigger audit_closings after insert or update or delete on public.monthly_closings for each row execute function public.write_audit();
create trigger audit_opex after insert or update or delete on public.opex_items for each row execute function public.write_audit();

-- Server-side running balance. The app compares its own total against this view.
create view public.branch_daily with (security_invoker = true) as
select
  d.branch_id,
  d.txn_date,
  public.accounting_period(d.txn_date) as period,
  d.capital_in_sen,
  d.purchases_sen,
  d.costs_sen,
  d.returned_sen,
  d.passed_sen,
  (b.opening_balance_sen + sum(d.capital_in_sen - d.purchases_sen - d.costs_sen - d.returned_sen - d.passed_sen)
    over (partition by d.branch_id order by d.txn_date))::bigint as balance_sen
from (
  select
    branch_id,
    txn_date,
    coalesce(sum(amount_sen) filter (where kind = 'capital_in'), 0)::bigint as capital_in_sen,
    coalesce(sum(amount_sen) filter (where kind = 'purchase'), 0)::bigint as purchases_sen,
    coalesce(sum(amount_sen) filter (where kind = 'cost'), 0)::bigint as costs_sen,
    coalesce(sum(amount_sen) filter (where kind = 'capital_return'), 0)::bigint as returned_sen,
    coalesce(sum(amount_sen) filter (where kind = 'capital_pass'), 0)::bigint as passed_sen
  from public.transactions
  where voided_at is null
  group by branch_id, txn_date
) d
join public.branches b on b.id = d.branch_id;

-- Multi-row writes go through functions so they stay atomic and enforce roles.
create function public.create_branch(branch_name text, opening_sen bigint default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sila log masuk semula.'; end if;
  insert into public.branches (name, opening_balance_sen, created_by)
  values (trim(branch_name), opening_sen, auth.uid()) returning id into new_id;
  insert into public.branch_members (branch_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

create function public.save_month(b uuid, p text, gross_sen bigint, month_notes text, items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh mengubah data bulanan.'; end if;
  if public.is_month_closed(b, p) then raise exception 'Bulan ini telah ditutup. Buka semula dahulu.'; end if;
  insert into public.monthly_closings (branch_id, period, gross_profit_sen, notes)
  values (b, p, gross_sen, month_notes)
  on conflict (branch_id, period) do update
    set gross_profit_sen = excluded.gross_profit_sen, notes = excluded.notes, updated_at = now();
  delete from public.opex_items where branch_id = b and period = p;
  insert into public.opex_items (branch_id, period, label, amount_sen)
  select b, p, trim(i ->> 'label'), (i ->> 'amount_sen')::bigint
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i;
end $$;

create function public.set_month_closed(b uuid, p text, closed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh menutup bulan.'; end if;
  insert into public.monthly_closings (branch_id, period) values (b, p)
  on conflict (branch_id, period) do nothing;
  update public.monthly_closings
  set closed_at = case when closed then now() end,
      closed_by = case when closed then auth.uid() end,
      updated_at = now()
  where branch_id = b and period = p;
end $$;

-- The person must already have an account (added under Supabase Authentication).
create function public.add_branch_member(b uuid, member_email text, member_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh menambah ahli.'; end if;
  select id into target from auth.users where lower(email) = lower(trim(member_email));
  if target is null then raise exception 'Akaun dengan e-mel itu belum wujud.'; end if;
  insert into public.branch_members (branch_id, user_id, role) values (b, target, member_role)
  on conflict (branch_id, user_id) do update set role = excluded.role;
end $$;

create function public.remove_branch_member(b uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh membuang ahli.'; end if;
  delete from public.branch_members where branch_id = b and user_id = member;
  if not exists (select 1 from public.branch_members where branch_id = b and role = 'owner') then
    raise exception 'Cawangan mesti ada sekurang-kurangnya seorang pemilik.';
  end if;
end $$;

create function public.list_branch_members(b uuid)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_branch_member(b) then raise exception 'Tiada akses ke cawangan ini.'; end if;
  return query
    select m.user_id, u.email::text, m.role
    from public.branch_members m join auth.users u on u.id = m.user_id
    where m.branch_id = b order by u.email;
end $$;

alter table public.branches enable row level security;
alter table public.branch_members enable row level security;
alter table public.transactions enable row level security;
alter table public.monthly_closings enable row level security;
alter table public.opex_items enable row level security;
alter table public.audit_log enable row level security;

create policy "Members read branches" on public.branches for select to authenticated
  using (public.is_branch_member(id));
create policy "Owners update branches" on public.branches for update to authenticated
  using (public.is_branch_owner(id)) with check (public.is_branch_owner(id));
create policy "Members read membership" on public.branch_members for select to authenticated
  using (public.is_branch_member(branch_id));
create policy "Members read transactions" on public.transactions for select to authenticated
  using (public.is_branch_member(branch_id));
create policy "Members add transactions" on public.transactions for insert to authenticated
  with check (public.is_branch_member(branch_id));
create policy "Members edit transactions" on public.transactions for update to authenticated
  using (public.is_branch_member(branch_id)) with check (public.is_branch_member(branch_id));
create policy "Members read closings" on public.monthly_closings for select to authenticated
  using (public.is_branch_member(branch_id));
create policy "Members read opex" on public.opex_items for select to authenticated
  using (public.is_branch_member(branch_id));
create policy "Owners read audit" on public.audit_log for select to authenticated
  using (public.is_branch_owner(branch_id));

-- There is deliberately no DELETE: transactions are voided and branches are archived.
grant select on public.branches, public.branch_members, public.transactions,
  public.monthly_closings, public.opex_items, public.audit_log, public.branch_daily to authenticated;
grant update (name, opening_balance_sen, archived_at) on public.branches to authenticated;
grant insert, update on public.transactions to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.accounting_period(date), public.is_branch_member(uuid),
  public.is_branch_owner(uuid), public.is_month_closed(uuid, text),
  public.create_branch(text, bigint), public.save_month(uuid, text, bigint, text, jsonb),
  public.set_month_closed(uuid, text, boolean), public.add_branch_member(uuid, text, text),
  public.remove_branch_member(uuid, uuid), public.list_branch_members(uuid) to authenticated;
