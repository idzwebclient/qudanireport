-- Marketing becomes its own monthly figure instead of an OPEX item recognised by name.
alter table public.monthly_closings
  add column marketing_sen bigint not null default 0 check (marketing_sen >= 0);

-- Existing "Iklan" / "Marketing" items move across, so every month's profit stays the same.
update public.monthly_closings c
set marketing_sen = moved.total
from (
  select branch_id, period, sum(amount_sen)::bigint as total
  from public.opex_items
  where label ~* '(iklan|marketing)'
  group by branch_id, period
) moved
where c.branch_id = moved.branch_id and c.period = moved.period;

delete from public.opex_items where label ~* '(iklan|marketing)';

drop function public.save_month(uuid, text, bigint, text, jsonb);

create function public.save_month(b uuid, p text, gross_sen bigint, month_notes text, items jsonb, marketing bigint default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_branch_owner(b) then raise exception 'Hanya pemilik boleh mengubah data bulanan.'; end if;
  if public.is_month_closed(b, p) then raise exception 'Bulan ini telah ditutup. Buka semula dahulu.'; end if;
  insert into public.monthly_closings (branch_id, period, gross_profit_sen, notes, marketing_sen)
  values (b, p, gross_sen, month_notes, marketing)
  on conflict (branch_id, period) do update
    set gross_profit_sen = excluded.gross_profit_sen, notes = excluded.notes, marketing_sen = excluded.marketing_sen, updated_at = now();
  delete from public.opex_items where branch_id = b and period = p;
  insert into public.opex_items (branch_id, period, label, amount_sen)
  select b, p, trim(i ->> 'label'), (i ->> 'amount_sen')::bigint
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i;
end $$;

revoke execute on function public.save_month(uuid, text, bigint, text, jsonb, bigint) from public, anon;
grant execute on function public.save_month(uuid, text, bigint, text, jsonb, bigint) to authenticated;
