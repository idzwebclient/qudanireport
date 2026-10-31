-- OPEX items are picked from a per-branch list, so one typo cannot split a cost across two names.
create table public.opex_categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
create unique index opex_categories_name_idx on public.opex_categories (branch_id, lower(trim(name)));

insert into public.opex_categories (branch_id, name)
select distinct on (branch_id, lower(trim(label))) branch_id, trim(label)
from public.opex_items
order by branch_id, lower(trim(label)), label;

create trigger audit_opex_categories after insert or update or delete on public.opex_categories
for each row execute function public.write_audit();

alter table public.opex_categories enable row level security;
create policy "Members read opex categories" on public.opex_categories for select to authenticated
  using (public.is_branch_member(branch_id));
grant select on public.opex_categories to authenticated;

create function public.add_opex_category(b uuid, category_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh mengubah senarai item.'; end if;
  insert into public.opex_categories (branch_id, name) values (b, trim(category_name))
  on conflict (branch_id, lower(trim(name))) do nothing;
end $$;

-- Renames everywhere, including closed months, since only the name changes and no amount does.
-- Renaming to a name that already exists merges the two.
create function public.rename_opex_category(category uuid, new_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  current_row public.opex_categories;
  target uuid;
begin
  select * into current_row from public.opex_categories where id = category;
  if current_row.id is null or not public.is_branch_owner(current_row.branch_id) then
    raise exception 'Hanya pemilik boleh mengubah senarai item.';
  end if;
  select id into target from public.opex_categories
  where branch_id = current_row.branch_id and lower(trim(name)) = lower(trim(new_name)) and id <> category;

  update public.opex_items set label = trim(new_name)
  where branch_id = current_row.branch_id and lower(trim(label)) = lower(trim(current_row.name));

  if target is null then
    update public.opex_categories set name = trim(new_name) where id = category;
  else
    delete from public.opex_categories where id = category;
    update public.opex_categories set name = trim(new_name) where id = target;
  end if;
end $$;

-- Removes the name from the dropdown only. Months that used it keep their figures.
create function public.delete_opex_category(category uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.opex_categories where id = category;
  if b is null or not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh mengubah senarai item.'; end if;
  delete from public.opex_categories where id = category;
end $$;

revoke execute on function public.add_opex_category(uuid, text), public.rename_opex_category(uuid, text), public.delete_opex_category(uuid) from public, anon;
grant execute on function public.add_opex_category(uuid, text), public.rename_opex_category(uuid, text), public.delete_opex_category(uuid) to authenticated;
