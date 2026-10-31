'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDays, type Txn } from './ledger';
import type { Branch, Month, OpexCategory, Repo } from './repo';

type BranchData = { txns: Txn[]; months: Month[]; categories?: OpexCategory[] };
type Snapshot = { branches: Branch[]; data: Record<string, BranchData>; activeId: string };
type Outbox = { txn: Txn; failed?: string }[];

export type SyncState = 'synced' | 'syncing' | 'offline' | 'pending' | 'failed';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the app still works, just without offline data.
  }
}

const isNetworkError = (error: unknown) =>
  !navigator.onLine || /failed to fetch|networkerror|load failed|network request/i.test((error as Error)?.message ?? '');

export function clearLocalData(userId: string) {
  try {
    localStorage.removeItem(`rekod:snapshot:${userId}`);
    localStorage.removeItem(`rekod:outbox:${userId}`);
    Object.keys(localStorage).filter(key => key.startsWith('rekod:draft:')).forEach(key => localStorage.removeItem(key));
  } catch {}
}

export function outboxCount(userId: string) {
  return read<Outbox>(`rekod:outbox:${userId}`, []).length;
}

export function useLedger(repo: Repo, userId: string) {
  const snapshotKey = `rekod:snapshot:${userId}`, outboxKey = `rekod:outbox:${userId}`;
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ branches: [], data: {}, activeId: '' });
  const [outbox, setOutbox] = useState<Outbox>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const outboxRef = useRef<Outbox>([]);
  const snapshotRef = useRef(snapshot);

  const commitSnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    write(snapshotKey, next);
  }, [snapshotKey]);

  const commitOutbox = useCallback((next: Outbox) => {
    outboxRef.current = next;
    setOutbox(next);
    write(outboxKey, next);
  }, [outboxKey]);

  const flush = useCallback(async () => {
    for (const item of outboxRef.current.filter(i => !i.failed)) {
      try {
        await repo.saveTransaction(item.txn);
        commitOutbox(outboxRef.current.filter(i => i.txn.id !== item.txn.id));
      } catch (error) {
        if (isNetworkError(error)) return false;
        commitOutbox(outboxRef.current.map(i => i.txn.id === item.txn.id ? { ...i, failed: (error as Error).message } : i));
      }
    }
    return true;
  }, [repo, commitOutbox]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setLoadError('');
    try {
      if (!(await flush())) throw new TypeError('failed to fetch');
      const branches = await repo.listBranches();
      const usable = branches.filter(b => !b.archived_at);
      const current = snapshotRef.current.activeId;
      const activeId = usable.some(b => b.id === current) ? current : usable[0]?.id ?? '';
      const data = { ...snapshotRef.current.data };
      if (activeId) {
        const [txns, months, categories] = await Promise.all([repo.listTransactions(activeId), repo.listMonths(activeId), repo.listOpexCategories(activeId)]);
        data[activeId] = { txns, months, categories };
      }
      commitSnapshot({ branches, data, activeId });
    } catch (error) {
      if (!isNetworkError(error)) setLoadError((error as Error).message || 'Tidak dapat memuatkan data.');
    } finally {
      setSyncing(false);
    }
  }, [repo, flush, commitSnapshot]);

  useEffect(() => {
    const start = async () => {
      const saved = read<Snapshot>(snapshotKey, { branches: [], data: {}, activeId: '' });
      snapshotRef.current = saved;
      setSnapshot(saved);
      const pending = read<Outbox>(outboxKey, []);
      outboxRef.current = pending;
      setOutbox(pending);
      setOnline(navigator.onLine);
      await refresh();
      setReady(true);
    };
    void start();
    const goOnline = () => { setOnline(true); void refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [refresh, snapshotKey, outboxKey]);

  const branch = snapshot.branches.find(b => b.id === snapshot.activeId) ?? null;
  const stored = snapshot.data[snapshot.activeId];

  // Unsent changes are laid over server data so balances are right while offline.
  const txns = useMemo(() => {
    const merged = new Map((stored?.txns ?? []).map(t => [t.id, t]));
    for (const { txn } of outbox) if (txn.branch_id === snapshot.activeId) merged.set(txn.id, txn);
    return [...merged.values()];
  }, [stored, outbox, snapshot.activeId]);

  const days = useMemo(() => buildDays(branch?.opening_balance_sen ?? 0, txns, branch?.opening_date), [branch, txns]);

  async function saveTransaction(txn: Txn) {
    commitOutbox([...outboxRef.current.filter(i => i.txn.id !== txn.id), { txn }]);
    if (!navigator.onLine) return;
    setSyncing(true);
    await flush();
    setSyncing(false);
    const failure = outboxRef.current.find(i => i.txn.id === txn.id)?.failed;
    if (failure) throw new Error(failure);
    const data = snapshotRef.current.data[txn.branch_id] ?? { txns: [], months: [] };
    const rest = data.txns.filter(t => t.id !== txn.id);
    commitSnapshot({
      ...snapshotRef.current,
      data: { ...snapshotRef.current.data, [txn.branch_id]: { ...data, txns: txn.voided_at ? rest : [...rest, txn] } },
    });
  }

  function discardFailed(id: string) {
    commitOutbox(outboxRef.current.filter(i => i.txn.id !== id));
  }

  async function switchBranch(id: string) {
    commitSnapshot({ ...snapshotRef.current, activeId: id });
    await refresh();
  }

  const failed = outbox.filter(i => i.failed);
  const sync: SyncState = failed.length ? 'failed' : syncing ? 'syncing' : !online ? 'offline' : outbox.length ? 'pending' : 'synced';

  return {
    ready, branch, branches: snapshot.branches, txns, days, months: stored?.months ?? [], categories: stored?.categories ?? [],
    online, sync, pendingCount: outbox.length, failed, loadError,
    saveTransaction, discardFailed, switchBranch, refresh,
  };
}
