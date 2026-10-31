// Runs the real migrations on an in-memory Postgres (PGlite), with a stub of Supabase's auth schema.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth, public to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  insert into auth.users values ('${A}', 'a@test.my'), ('${B}', 'b@test.my'), ('${C}', 'c@test.my');
`);
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const file of readdirSync(dir).sort()) {
  // Seed old-style data just before the migration that moves it, to prove profit is unchanged.
  if (file.includes('marketing_field')) {
    await db.exec(`
      insert into branches (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Lama');
      insert into monthly_closings (branch_id, period, gross_profit_sen) values ('00000000-0000-0000-0000-0000000000d1', '2026-10', 873321);
      insert into opex_items (branch_id, period, label, amount_sen) values
        ('00000000-0000-0000-0000-0000000000d1', '2026-10', 'Iklan', 805000),
        ('00000000-0000-0000-0000-0000000000d1', '2026-10', 'FB Marketing', 100),
        ('00000000-0000-0000-0000-0000000000d1', '2026-10', 'Sewa', 280000);
    `);
  }
  await db.exec(readFileSync(new URL(file, dir), 'utf8'));
}

async function as(uid, sql, params = []) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec(`reset role; set test.uid = '';`); }
}
async function refuses(promise, pattern, message) {
  await assert.rejects(promise, pattern, message);
}

assert.equal((await db.query(`select count(*)::int c from opex_categories where branch_id = '00000000-0000-0000-0000-0000000000d1' and name = 'Sewa'`)).rows[0].c, 1, 'item sedia ada masuk senarai');
const moved = (await db.query(`select marketing_sen::int m, (select array_agg(label) from opex_items i where i.branch_id = c.branch_id) l from monthly_closings c where branch_id = '00000000-0000-0000-0000-0000000000d1'`)).rows[0];
assert.equal(moved.m, 805100, 'iklan dipindah');
assert.deepEqual(moved.l, ['Sewa'], 'item lain kekal');

// Period boundaries
const period = async d => (await db.query(`select public.accounting_period('${d}'::date) p`)).rows[0].p;
assert.equal(await period('2026-10-24'), '2026-10');
assert.equal(await period('2026-10-25'), '2026-11');
assert.equal(await period('2026-12-31'), '2027-01');

// Branch creation makes the caller owner, and others cannot see it
const [{create_branch: branch}] = await as(A, `select public.create_branch('Alor Setar', 100000)`);
assert.equal((await as(A, 'select * from branches')).length, 1);
assert.equal((await as(B, 'select * from branches')).length, 0, 'bukan ahli tidak boleh nampak cawangan');
await refuses(as(B, `insert into transactions (branch_id, txn_date, kind, amount_sen) values ('${branch}', '2026-10-01', 'purchase', 100)`), /row-level security/, 'bukan ahli tidak boleh menulis');

// Staff can record but cannot manage
await as(A, `select public.add_branch_member('${branch}', 'b@test.my', 'staff')`);
await as(B, `insert into transactions (branch_id, txn_date, kind, amount_sen) values ('${branch}', '2026-10-01', 'capital_in', 50000), ('${branch}', '2026-10-01', 'purchase', 20000), ('${branch}', '2026-10-02', 'cost', 5000)`);
await refuses(as(B, `select public.save_month('${branch}', '2026-10', 100, '', '[]')`), /pemilik/);
await refuses(as(B, `select public.set_month_closed('${branch}', '2026-10', true)`), /pemilik/);
await refuses(as(B, `select public.add_branch_member('${branch}', 'c@test.my', 'staff')`), /pemilik/);
const updated = await as(B, `update branches set name = 'X' where id = '${branch}' returning id`);
assert.equal(updated.length, 0, 'staff tidak boleh mengubah cawangan');

// There is no hard delete
await refuses(as(A, `delete from transactions where branch_id = '${branch}'`), /permission denied/);
await refuses(as(A, `delete from branches where id = '${branch}'`), /permission denied/);

// The view carries balances forward and ignores voided rows
const balances = async () => (await as(A, `select txn_date::text d, balance_sen::int b from branch_daily where branch_id = '${branch}' order by 1`)).map(r => r.b);
assert.deepEqual(await balances(), [130000, 125000]);
await as(A, `update transactions set voided_at = now() where kind = 'cost'`);
assert.deepEqual(await balances(), [130000]);
await as(A, `update transactions set voided_at = null where kind = 'cost'`);

// Other costs are accepted and reduce the balance
await as(A, `insert into transactions (branch_id, txn_date, kind, amount_sen, description) values ('${branch}', '2026-10-02', 'other_cost', 1000, 'Baiki')`);
assert.deepEqual(await balances(), [130000, 124000]);
assert.equal((await as(A, `select other_costs_sen::int o from branch_daily where txn_date = '2026-10-02'`))[0].o, 1000);
await as(A, `update transactions set voided_at = now() where kind = 'other_cost'`);

// Month saves are atomic and replace OPEX
await as(A, `select public.save_month('${branch}', '2026-10', 90000, 'nota', '[{"label":"Sewa","amount_sen":1000},{"label":"Gaji","amount_sen":2000}]')`);
await as(A, `select public.save_month('${branch}', '2026-10', 90000, 'nota', '[{"label":"Sewa","amount_sen":1500}]')`);
assert.equal((await as(A, 'select * from opex_items')).length, 1);

// A month can end in a gross loss
await as(A, `select public.save_month('${branch}', '2026-08', -5000, '', '[]')`);
assert.equal((await as(A, `select gross_profit_sen::int g from monthly_closings where period = '2026-08'`))[0].g, -5000);

// Marketing saves separately
await as(A, `select public.save_month('${branch}', '2026-07', 100, '', '[]', 40)`);
assert.equal((await as(A, `select marketing_sen::int m from monthly_closings where period = '2026-07'`))[0].m, 40);

// OPEX names come from a list; renaming to an existing name merges everywhere, and amounts survive
await as(A, `select public.save_month('${branch}', '2026-06', 100, '', '[{"label":"Api, Air, Wifi","amount_sen":10},{"label":"Sewa","amount_sen":20}]')`);
await as(A, `select public.add_opex_category('${branch}', 'Api, Air, Wifi')`);
await as(A, `select public.add_opex_category('${branch}', 'api, air, wifi ')`);
await as(A, `select public.add_opex_category('${branch}', 'Api, Air, Bil Telefon, Wifi')`);
await refuses(as(B, `select public.add_opex_category('${branch}', 'X')`), /pemilik/);
await refuses(as(A, `insert into opex_categories (branch_id, name) values ('${branch}', 'X')`), /permission denied/);
const categories = async () => (await as(B, `select id::text, name from opex_categories where branch_id = '${branch}' order by name`));
assert.equal((await categories()).length, 2, 'nama sama tak berganda walau huruf berbeza');
const longName = (await categories()).find(c => c.name.includes('Telefon')).id;
await refuses(as(B, `select public.rename_opex_category('${longName}', 'X')`), /pemilik/);
await as(A, `select public.save_month('${branch}', '2026-05', 100, '', '[{"label":"Api, Air, Bil Telefon, Wifi","amount_sen":30}]')`);
await as(A, `select public.rename_opex_category('${longName}', 'Api, Air, Wifi')`);
assert.deepEqual((await categories()).map(c => c.name), ['Api, Air, Wifi'], 'digabung');
assert.equal((await as(A, `select sum(amount_sen)::int s from opex_items where branch_id = '${branch}' and label = 'Api, Air, Wifi'`))[0].s, 40, 'amaun dikekalkan');
const lastId = (await categories())[0].id;
await as(A, `select public.delete_opex_category('${lastId}')`);
assert.equal((await as(A, `select count(*)::int c from opex_items where branch_id = '${branch}' and label = 'Api, Air, Wifi'`))[0].c, 2, 'buang dari senarai tak ubah angka');

// Closing locks the period and the opening balance, reopening unlocks
await as(A, `select public.set_month_closed('${branch}', '2026-10', true)`);
await refuses(as(B, `insert into transactions (branch_id, txn_date, kind, amount_sen) values ('${branch}', '2026-10-24', 'cost', 1)`), /ditutup/);
await refuses(as(B, `update transactions set amount_sen = 1 where kind = 'cost'`), /ditutup/);
await refuses(as(A, `select public.save_month('${branch}', '2026-10', 1, '', '[]')`), /ditutup/);
await refuses(as(A, `update branches set opening_balance_sen = 1 where id = '${branch}'`), /Nilai permulaan/);
await as(B, `insert into transactions (branch_id, txn_date, kind, amount_sen) values ('${branch}', '2026-10-25', 'cost', 1)`);
await refuses(as(B, `update transactions set txn_date = '2026-10-01' where txn_date = '2026-10-25'`), /ditutup/, 'tidak boleh pindah rekod ke bulan ditutup');
assert.equal((await as(A, `select closed_at from monthly_closings where period = '2026-10'`))[0].closed_at !== null, true);
await as(A, `select public.set_month_closed('${branch}', '2026-10', false)`);
await as(B, `update transactions set amount_sen = 6000 where kind = 'cost' and txn_date = '2026-10-02'`);

// Ownership fields survive edits, and audit is owner-only and records changes
assert.equal((await as(B, `select created_by::text c from transactions where kind = 'cost' limit 1`))[0].c, B);
assert.ok((await as(A, `select * from audit_log where table_name = 'transactions' and action = 'UPDATE'`)).length > 0);
assert.equal((await as(B, 'select * from audit_log')).length, 0, 'staff tidak boleh baca audit');
await refuses(as(A, `delete from audit_log`), /permission denied/);

// Opening date excludes earlier records from the view; opening figures need a date and an owner
await as(A, `update branches set opening_date = '2026-10-02' where id = '${branch}'`);
assert.equal((await as(A, `select count(*)::int c from branch_daily where branch_id = '${branch}' and txn_date < '2026-10-02'`))[0].c, 0);
await as(A, `update branches set opening_date = null where id = '${branch}'`);
await refuses(as(A, `update branches set opening_pl_sen = -500 where id = '${branch}'`), /branches_opening_pl_has_date/);
await as(A, `update branches set opening_pl_sen = -500, opening_pl_date = '2026-09-30' where id = '${branch}'`);
assert.equal((await as(B, `update branches set opening_pl_sen = 0, opening_pl_date = null where id = '${branch}' returning id`)).length, 0, 'staff tidak boleh ubah');
await as(A, `select public.set_month_closed('${branch}', '2026-10', true)`);
await refuses(as(A, `update branches set opening_pl_sen = 0, opening_pl_date = null where id = '${branch}'`), /Nilai permulaan/);
await as(A, `select public.set_month_closed('${branch}', '2026-10', false)`);

// The last owner cannot be removed, nor can strangers list members
await refuses(as(A, `select public.remove_branch_member('${branch}', '${A}')`), /pemilik/);
await refuses(as(C, `select * from public.list_branch_members('${branch}')`), /akses/);
assert.equal((await as(B, `select * from public.list_branch_members('${branch}')`)).length, 2);

console.log('✓ Schema, RLS, kunci bulan, dan audit lulus.');
await db.close();
