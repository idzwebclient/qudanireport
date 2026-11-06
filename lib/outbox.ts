import type { Txn } from './ledger';

export type OutboxItem = { txn: Txn; failed?: string };

// Sends queued records one flush at a time, so an older edit can never reach the server after a newer one.
export function createFlusher({ read, write, save, isNetworkError }: {
  read: () => OutboxItem[];
  write: (next: OutboxItem[]) => void;
  save: (txn: Txn) => Promise<void>;
  isNetworkError: (error: unknown) => boolean;
}) {
  let chain: Promise<boolean> = Promise.resolve(true);
  const run = async () => {
    for (const item of read().filter(i => !i.failed)) {
      try {
        await save(item.txn);
        // Compare the entry itself: a newer edit of the same record queued meanwhile must stay to be sent.
        write(read().filter(i => i !== item));
      } catch (error) {
        if (isNetworkError(error)) return false;
        write(read().map(i => (i === item ? { ...i, failed: (error as Error).message } : i)));
      }
    }
    return true;
  };
  return () => {
    const next = chain.then(run, run);
    chain = next.catch(() => false);
    return next;
  };
}
