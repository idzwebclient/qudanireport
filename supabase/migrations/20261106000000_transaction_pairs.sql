-- Links a belian to the kos saved with it, so editing one can find the other.
-- Older records stay unlinked; the app pairs those by their shared note.
alter table public.transactions add column pair_id uuid;
create index transactions_pair_idx on public.transactions (pair_id) where pair_id is not null;
