import type { SupabaseClient } from '@supabase/supabase-js';
import type { Txn } from './ledger';

export type Role = 'owner' | 'staff';
export type Branch = { id: string; name: string; opening_balance_sen: number; opening_date: string | null; opening_pl_sen: number; opening_pl_date: string | null; archived_at: string | null; role: Role };
export type OpexItem = { id: string; label: string; amount_sen: number };
export type Month = { period: string; gross_profit_sen: number; marketing_sen: number; notes: string; closed_at: string | null; opex: OpexItem[] };
export type OpexCategory = { id: string; name: string };
export type Member = { user_id: string; email: string; role: Role };

export interface Repo {
  listBranches(): Promise<Branch[]>;
  createBranch(name: string, openingSen: number): Promise<string>;
  updateBranch(id: string, patch: Partial<Omit<Branch, 'id' | 'role'>>): Promise<void>;
  listTransactions(branchId: string): Promise<Txn[]>;
  saveTransaction(txn: Txn): Promise<void>;
  listMonths(branchId: string): Promise<Month[]>;
  saveMonth(branchId: string, period: string, grossSen: number, notes: string, items: { label: string; amount_sen: number }[], marketingSen: number): Promise<void>;
  setMonthClosed(branchId: string, period: string, closed: boolean): Promise<void>;
  serverBalance(branchId: string, upToDate: string): Promise<number | null>;
  listMembers(branchId: string): Promise<Member[]>;
  addMember(branchId: string, email: string, role: Role): Promise<void>;
  removeMember(branchId: string, userId: string): Promise<void>;
  listOpexCategories(branchId: string): Promise<OpexCategory[]>;
  addOpexCategory(branchId: string, name: string): Promise<void>;
  renameOpexCategory(id: string, name: string): Promise<void>;
  deleteOpexCategory(id: string): Promise<void>;
}

const PAGE = 1000;

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function supabaseRepo(db: SupabaseClient, userId: string): Repo {
  return {
    async listBranches() {
      // RLS already limits branches to the user's own, so both can be read in one round trip.
      const [memberResult, branchResult] = await Promise.all([
        db.from('branch_members').select('branch_id, role').eq('user_id', userId),
        db.from('branches').select('id, name, opening_balance_sen, opening_date, opening_pl_sen, opening_pl_date, archived_at').order('name'),
      ]);
      const memberships = check(memberResult) as { branch_id: string; role: Role }[];
      const rows = check(branchResult) as Omit<Branch, 'role'>[];
      return rows.flatMap(b => {
        const role = memberships.find(m => m.branch_id === b.id)?.role;
        return role ? [{ ...b, role }] : [];
      });
    },
    async createBranch(name, openingSen) {
      return check(await db.rpc('create_branch', { branch_name: name, opening_sen: openingSen })) as string;
    },
    async updateBranch(id, patch) {
      check(await db.from('branches').update(patch).eq('id', id));
    },
    async listTransactions(branchId) {
      const all: Txn[] = [];
      // PostgREST caps a response at 1000 rows, so read in pages.
      for (let from = 0; ; from += PAGE) {
        const page = check(await db.from('transactions')
          .select('id, branch_id, txn_date, kind, amount_sen, description, counterparty, voided_at')
          .eq('branch_id', branchId).is('voided_at', null)
          .order('txn_date').order('created_at').order('id')
          .range(from, from + PAGE - 1)) as Txn[];
        all.push(...page);
        if (page.length < PAGE) return all;
      }
    },
    async saveTransaction(txn) {
      check(await db.from('transactions').upsert(txn, { onConflict: 'id' }));
    },
    async listMonths(branchId) {
      const [closings, items] = await Promise.all([
        db.from('monthly_closings').select('period, gross_profit_sen, marketing_sen, notes, closed_at').eq('branch_id', branchId),
        db.from('opex_items').select('id, period, label, amount_sen').eq('branch_id', branchId),
      ]);
      const opex = check(items) as (OpexItem & { period: string })[];
      return (check(closings) as Omit<Month, 'opex'>[]).map(m => ({
        ...m,
        opex: opex.filter(o => o.period === m.period).map(({ id, label, amount_sen }) => ({ id, label, amount_sen })),
      }));
    },
    async saveMonth(branchId, period, grossSen, notes, items, marketingSen) {
      check(await db.rpc('save_month', { b: branchId, p: period, gross_sen: grossSen, month_notes: notes, items, marketing: marketingSen }));
    },
    async setMonthClosed(branchId, period, closed) {
      check(await db.rpc('set_month_closed', { b: branchId, p: period, closed }));
    },
    async serverBalance(branchId, upToDate) {
      const rows = check(await db.from('branch_daily').select('balance_sen').eq('branch_id', branchId).lte('txn_date', upToDate).order('txn_date', { ascending: false }).limit(1)) as { balance_sen: number }[];
      return rows[0]?.balance_sen ?? null;
    },
    async listMembers(branchId) {
      return check(await db.rpc('list_branch_members', { b: branchId })) as Member[];
    },
    async addMember(branchId, email, role) {
      check(await db.rpc('add_branch_member', { b: branchId, member_email: email, member_role: role }));
    },
    async removeMember(branchId, userId_) {
      check(await db.rpc('remove_branch_member', { b: branchId, member: userId_ }));
    },
    async listOpexCategories(branchId) {
      return check(await db.from('opex_categories').select('id, name').eq('branch_id', branchId).order('name')) as OpexCategory[];
    },
    async addOpexCategory(branchId, name) {
      check(await db.rpc('add_opex_category', { b: branchId, category_name: name }));
    },
    async renameOpexCategory(id, name) {
      check(await db.rpc('rename_opex_category', { category: id, new_name: name }));
    },
    async deleteOpexCategory(id) {
      check(await db.rpc('delete_opex_category', { category: id }));
    },
  };
}
