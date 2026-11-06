'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Lock, Pencil } from 'lucide-react';
import { dayView, KIND_LABEL, longDateLabel, money, pairPurchases, parseSen, periodOf, senToInput, todayKL, type Day, type Pair, type Txn, type TxnKind } from '../lib/ledger';
import type { Branch } from '../lib/repo';
import type { useLedger } from '../lib/use-ledger';
import { AmountInput } from './amount-input';
import { ReportPanel } from './report';

type EntryTab = 'capital_in' | 'purchase_cost' | 'other_cost' | 'capital_return' | 'capital_pass';
const TABS: [EntryTab, string][] = [
  ['capital_in', 'Modal masuk'],
  ['purchase_cost', 'Belian & kos'],
  ['other_cost', 'Lain-lain kos'],
  ['capital_return', 'Pulang modal'],
  ['capital_pass', 'Pass modal'],
];
const isTransfer = (kind: TxnKind | EntryTab) => kind === 'capital_return' || kind === 'capital_pass';
const noteLabel = (kind: TxnKind | EntryTab) => (isTransfer(kind) ? 'Kepada siapa' : kind === 'other_cost' ? 'Detail' : 'Catatan (tak wajib)');
const notePlaceholder = (kind: TxnKind | EntryTab) => (isTransfer(kind) ? 'Contoh: HQ' : kind === 'capital_in' ? 'Contoh: Dari HQ' : kind === 'other_cost' ? 'Contoh: Baiki kaunter' : 'Contoh: Emas 916');

type Draft = { amount: string; cost?: string; note: string; pairId?: string };
type Drafts = Partial<Record<EntryTab, Draft>>;

// Unsaved amounts survive switching record type, leaving the screen and reloading.
function readDrafts(key: string): Drafts {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Drafts;
  } catch {
    return {};
  }
}

function writeDrafts(key: string, drafts: Drafts) {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(key, JSON.stringify(drafts));
    else localStorage.removeItem(key);
  } catch {
    // Without storage the drafts still last until this screen closes.
  }
}

const savedTotal = (day: Day, kind: TxnKind) => day.txns.filter(t => t.kind === kind).reduce((total, t) => total + t.amount_sen, 0);
// Lain-lain kos is retired: it only appears on a day that still holds old records, so they stay editable.
const visibleTabs = (day: Day) => TABS.filter(([id]) => id !== 'other_cost' || savedTotal(day, 'other_cost') > 0);
const draftFilled = (draft?: Draft) => Boolean(draft?.amount.trim() || draft?.cost?.trim());
// A blank field counts as nothing; only text that fails to parse is invalid.
const draftValid = (draft: Draft) => [draft.amount, draft.cost ?? ''].every(v => !v.trim() || parseSen(v));
const draftSen = (draft?: Draft) => (parseSen(draft?.amount ?? '') ?? 0) + (parseSen(draft?.cost ?? '') ?? 0);

function EditForm({ txn, onSave, onDone }: { txn: Txn; onSave: (txn: Txn) => Promise<void>; onDone: () => void }) {
  const [amount, setAmount] = useState(senToInput(txn.amount_sen));
  const [note, setNote] = useState(txn.description || txn.counterparty);
  const [busy, setBusy] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState('');

  async function persist(next: Txn) {
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const sen = parseSen(amount);
    if (!sen) return setError('Masukkan amaun lebih daripada 0, contoh 150.50');
    void persist({ ...txn, amount_sen: sen, description: isTransfer(txn.kind) ? '' : note.trim(), counterparty: isTransfer(txn.kind) ? note.trim() : '' });
  }

  return (
    <form className="txn-edit stack" onSubmit={submit}>
      <b>Ubah {KIND_LABEL[txn.kind].toLowerCase()}</b>
      <AmountInput label="Amaun" value={amount} onChange={setAmount} />
      <label className="field">
        <span>{noteLabel(txn.kind)}</span>
        <input maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={notePlaceholder(txn.kind)} />
      </label>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
      {confirmVoid ? (
        <div className="confirm">
          <span>Buang rekod ini? Baki akan dikira semula.</span>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void persist({ ...txn, voided_at: new Date().toISOString() })}>Ya, buang</button>
          <button type="button" className="btn" onClick={() => setConfirmVoid(false)}>Tak jadi</button>
        </div>
      ) : (
        <div className="form-secondary">
          <button type="button" className="btn" onClick={onDone}>Batal</button>
          <button type="button" className="btn btn-ghost-danger" onClick={() => setConfirmVoid(true)}>Buang rekod</button>
        </div>
      )}
    </form>
  );
}

function PairEditForm({ pair, branchId, date, onSave, onDone }: { pair: Pair; branchId: string; date: string; onSave: (txn: Txn) => Promise<void>; onDone: () => void }) {
  const [purchase, setPurchase] = useState(senToInput(pair.purchase?.amount_sen ?? 0));
  const [cost, setCost] = useState(senToInput(pair.cost?.amount_sen ?? 0));
  const [note, setNote] = useState(pair.purchase?.description ?? pair.cost?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState('');

  // Each part is its own record: changed, added, or removed when its amount is cleared.
  // When both remain, they share one pair_id, which also links older records saved before it existed.
  const part = (kind: 'purchase' | 'cost', existing: Txn | undefined, sen: number, voided: boolean, pairId: string | null): Txn | null => {
    if (existing) {
      if (voided || !sen) return { ...existing, voided_at: new Date().toISOString() };
      return { ...existing, amount_sen: sen, description: note.trim(), pair_id: pairId ?? existing.pair_id ?? null };
    }
    if (voided || !sen) return null;
    return { id: crypto.randomUUID(), branch_id: branchId, txn_date: date, kind, amount_sen: sen, description: note.trim(), counterparty: '', voided_at: null, pair_id: pairId };
  };

  async function persist(voided: boolean) {
    const purchaseSen = purchase.trim() ? parseSen(purchase) : 0;
    const costSen = cost.trim() ? parseSen(cost) : 0;
    if (!voided) {
      if (purchaseSen === null || costSen === null) return setError('Amaun tidak sah. Contoh: 150.50');
      if (!purchaseSen && !costSen) return setError('Masukkan amaun belian atau kos, atau tekan Buang rekod.');
    }
    setBusy(true);
    setError('');
    try {
      const pairId = !voided && purchaseSen && costSen ? pair.purchase?.pair_id ?? pair.cost?.pair_id ?? crypto.randomUUID() : null;
      for (const txn of [part('purchase', pair.purchase, purchaseSen ?? 0, voided, pairId), part('cost', pair.cost, costSen ?? 0, voided, pairId)]) {
        if (txn) await onSave(txn);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="txn-edit stack" onSubmit={e => { e.preventDefault(); void persist(false); }}>
      <b>Ubah belian & kos</b>
      <div className="amount-pair">
        <AmountInput label="Amaun belian" value={purchase} onChange={setPurchase} />
        <AmountInput label="Amaun kos" value={cost} onChange={setCost} />
      </div>
      <label className="field">
        <span>{noteLabel('purchase')}</span>
        <input maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={notePlaceholder('purchase')} />
      </label>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
      {confirmVoid ? (
        <div className="confirm">
          <span>Buang belian dan kos ini? Baki akan dikira semula.</span>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void persist(true)}>Ya, buang</button>
          <button type="button" className="btn" onClick={() => setConfirmVoid(false)}>Tak jadi</button>
        </div>
      ) : (
        <div className="form-secondary">
          <button type="button" className="btn" onClick={onDone}>Batal</button>
          <button type="button" className="btn btn-ghost-danger" onClick={() => setConfirmVoid(true)}>Buang rekod</button>
        </div>
      )}
    </form>
  );
}

const TAB_KINDS: Record<EntryTab, TxnKind[]> = {
  capital_in: ['capital_in'],
  purchase_cost: ['purchase', 'cost'],
  other_cost: ['other_cost'],
  capital_return: ['capital_return'],
  capital_pass: ['capital_pass'],
};

function SavedRecords({ tab, tabName, branchId, day, locked, onSave }: {
  tab: EntryTab;
  tabName: string;
  branchId: string;
  day: Day;
  locked: boolean;
  onSave: (txn: Txn) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const kinds = TAB_KINDS[tab];
  const rows = day.txns.filter(t => kinds.includes(t.kind));
  const total = rows.reduce((sum, t) => sum + t.amount_sen, 0);
  return (
    <section className="saved" aria-label={`${tabName} yang dah disimpan`}>
      <header><span>{tabName} dah disimpan</span><b>{money(total)}</b></header>
      {rows.length && tab === 'purchase_cost' ? (
        <ul>
          {pairPurchases(rows).map(pair => (
            <li key={pair.key}>
              {editingId === pair.key ? (
                <PairEditForm pair={pair} branchId={branchId} date={day.date} onSave={onSave} onDone={() => setEditingId(null)} />
              ) : (
                <div className="saved-row">
                  <span>
                    <b>Belian</b>
                    <strong>{money(pair.purchase?.amount_sen ?? 0)}</strong>
                    <small>Kos {money(pair.cost?.amount_sen ?? 0)}{(pair.purchase ?? pair.cost)!.description ? ` · ${(pair.purchase ?? pair.cost)!.description}` : ''}</small>
                  </span>
                  {!locked && <button type="button" className="btn btn-small" onClick={() => setEditingId(pair.key)}><Pencil size={14} /> Ubah</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <ul>
          {rows.map(txn => (
            <li key={txn.id}>
              {editingId === txn.id ? (
                <EditForm txn={txn} onSave={onSave} onDone={() => setEditingId(null)} />
              ) : (
                <div className="saved-row">
                  <span>
                    {kinds.length > 1 && <b>{KIND_LABEL[txn.kind]}</b>}
                    <strong>{money(txn.amount_sen)}</strong>
                    {(txn.description || txn.counterparty) && <small>{txn.description || txn.counterparty}</small>}
                  </span>
                  {!locked && <button type="button" className="btn btn-small" onClick={() => setEditingId(txn.id)}><Pencil size={14} /> Ubah</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Belum ada rekod.</p>}
    </section>
  );
}

function EntryForm({ branchId, date, day, drafts, setDrafts, onSave, tab, setTab, locked }: {
  branchId: string;
  date: string;
  day: Day;
  drafts: Drafts;
  setDrafts: (drafts: Drafts) => void;
  onSave: (txn: Txn) => Promise<void>;
  tab: EntryTab;
  setTab: (tab: EntryTab) => void;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const current = drafts[tab] ?? { amount: '', cost: '', note: '' };
  const tabs = visibleTabs(day);
  const filled = tabs.map(([id]) => id).filter(id => draftFilled(drafts[id]));
  const tabName = (id: EntryTab) => TABS.find(([t]) => t === id)![1];

  function update(patch: Partial<Draft>) {
    const next = { ...current, ...patch };
    const rest = { ...drafts };
    if (next.amount || next.cost || next.note) rest[tab] = next;
    else delete rest[tab];
    setDrafts(rest);
    setMessage(null);
  }

  const makeTxn = (kind: TxnKind, sen: number, note: string, pairId: string | null = null): Txn => ({
    id: crypto.randomUUID(),
    branch_id: branchId,
    txn_date: date,
    kind,
    amount_sen: sen,
    description: isTransfer(kind) ? '' : note.trim(),
    counterparty: isTransfer(kind) ? note.trim() : '',
    voided_at: null,
    pair_id: pairId,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!filled.length) return setMessage({ ok: false, text: 'Masukkan amaun dahulu.' });
    const invalid = filled.find(id => !draftValid(drafts[id]!));
    if (invalid) {
      setTab(invalid);
      return setMessage({ ok: false, text: `Amaun ${tabName(invalid).toLowerCase()} tidak sah. Contoh: 150.50` });
    }
    setBusy(true);
    setMessage(null);
    let remaining = drafts, count = 0;
    // Each saved part leaves the draft immediately, so a retry after a failure cannot save it twice.
    const settle = (id: EntryTab, next?: Draft) => {
      remaining = { ...remaining };
      if (next) remaining[id] = next;
      else delete remaining[id];
      setDrafts(remaining);
      count++;
    };
    try {
      for (const id of filled) {
        const draft = drafts[id]!;
        if (id === 'purchase_cost') {
          const purchase = parseSen(draft.amount), cost = parseSen(draft.cost ?? '');
          // Kept in the draft, so a kos retried after a failure still links to its belian.
          const pairId = draft.pairId ?? (purchase && cost ? crypto.randomUUID() : null);
          if (purchase) {
            await onSave(makeTxn('purchase', purchase, draft.note, pairId));
            settle(id, { ...draft, amount: '', pairId: pairId ?? undefined });
          }
          if (cost) {
            await onSave(makeTxn('cost', cost, draft.note, pairId));
            settle(id);
          } else if (remaining[id]) {
            remaining = { ...remaining };
            delete remaining[id];
            setDrafts(remaining);
          }
        } else {
          await onSave(makeTxn(id, parseSen(draft.amount)!, draft.note));
          settle(id);
        }
      }
      setMessage({ ok: true, text: count === 1 ? 'Rekod disimpan.' : `${count} rekod disimpan.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2 className="card-title">Isi rekod</h2>
      <div className="kind-picker" role="group" aria-label="Jenis rekod">
        {tabs.map(([id, label]) => {
          const pending = draftSen(drafts[id]);
          return (
            <button type="button" key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setMessage(null); }}>
              <span>{label}</span>
              {id === 'purchase_cost' ? (
                <b className="kind-pair">{money(savedTotal(day, 'purchase'))}<em>Kos {money(savedTotal(day, 'cost'))}</em></b>
              ) : <b>{money(savedTotal(day, id))}</b>}
              {pending ? <small>+{money(pending)} belum simpan</small> : null}
            </button>
          );
        })}
      </div>
      <SavedRecords key={tab} tab={tab} tabName={tabName(tab)} branchId={branchId} day={day} locked={locked} onSave={onSave} />
      {!locked && <form className="stack" onSubmit={submit}>
      <h3 className="add-title">Tambah {tabName(tab).toLowerCase()} baru</h3>
      {tab === 'purchase_cost' ? (
        <div className="amount-pair">
          <AmountInput label="Amaun belian" value={current.amount} onChange={amount => update({ amount })} large />
          <AmountInput label="Amaun kos" value={current.cost ?? ''} onChange={cost => update({ cost })} large />
        </div>
      ) : (
        <AmountInput label={`Amaun ${tabName(tab).toLowerCase()}`} value={current.amount} onChange={amount => update({ amount })} large />
      )}
      <label className="field">
        <span>{noteLabel(tab)}</span>
        <input maxLength={200} value={current.note} onChange={e => update({ note: e.target.value })} placeholder={notePlaceholder(tab)} />
      </label>
      {message && <div className={`alert ${message.ok ? 'alert-ok' : 'alert-error'}`} role="status">{message.ok && <CheckCircle2 size={16} />}<span>{message.text}</span></div>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Menyimpan…' : filled.length > 1 ? `Simpan semua (${filled.length} tab)` : 'Simpan rekod'}
      </button>
      </form>}
    </section>
  );
}

function DaySummary({ day, draftNet, onOpen }: { day: Day; draftNet: number; onOpen: (tab: EntryTab) => void }) {
  const line = (label: string, value: number, tab: EntryTab) => (
    <div><dt><button type="button" className="equation-link" onClick={() => onOpen(tab)}>{label}</button></dt><dd>{money(value)}</dd></div>
  );
  return (
    <section className={`card day-summary${day.balance < 0 ? ' day-summary-negative' : ''}`}>
      <h2 className="card-title">Kiraan hari ini</h2>
      <dl className="equation">
        <div><dt>Modal awal</dt><dd>{money(day.start)}</dd></div>
        {line('+ Modal masuk', day.capitalIn, 'capital_in')}
        {line('− Belian', day.purchases, 'purchase_cost')}
        {line('− Kos', day.costs, 'purchase_cost')}
        {day.otherCosts > 0 && line('− Lain-lain kos', day.otherCosts, 'other_cost')}
        {line('− Pulang modal', day.returned, 'capital_return')}
        {line('− Pass modal', day.passed, 'capital_pass')}
        <div className="equation-total"><dt>Baki modal</dt><dd>{money(day.balance)}</dd></div>
        {draftNet !== 0 && <div className="equation-draft"><dt>Baki selepas simpan</dt><dd>{money(day.balance + draftNet)}</dd></div>}
      </dl>
      {day.balance < 0 && <p className="check check-bad">Baki negatif. Semak semula jumlah yang dimasukkan.</p>}
    </section>
  );
}

function DayPanel({ branch, date, day, days, locked, beforeOpening, onSave }: {
  branch: Branch;
  date: string;
  day: Day;
  days: Day[];
  locked: boolean;
  beforeOpening: boolean;
  onSave: (txn: Txn) => Promise<void>;
}) {
  const draftKey = `rekod:draft:${branch.id}:${date}`;
  const [drafts, setDraftsState] = useState<Drafts>(() => readDrafts(draftKey));
  const [tab, setTab] = useState<EntryTab>('capital_in');
  const setDrafts = (next: Drafts) => {
    setDraftsState(next);
    writeDrafts(draftKey, next);
  };
  const draftNet = visibleTabs(day).reduce((total, [id]) => total + (id === 'capital_in' ? 1 : -1) * draftSen(drafts[id]), 0);

  return (
    <div className="today">
      <div className="stack">
        {locked && <div className="alert alert-warn"><Lock size={16} /> {beforeOpening ? 'Tarikh ini sebelum tarikh modal permulaan. Ubah tarikh di Tetapan untuk merekod di sini.' : 'Bulan ini telah ditutup. Buka semula di skrin Bulanan untuk mengubah rekod.'}</div>}
        <EntryForm branchId={branch.id} date={date} day={day} drafts={drafts} setDrafts={setDrafts} onSave={onSave} tab={tab} setTab={setTab} locked={locked} />
      </div>
      <div className="stack today-side">
        <DaySummary day={day} draftNet={draftNet} onOpen={setTab} />
        <ReportPanel branch={branch.name} day={day} days={days} opening={branch.opening_balance_sen} />
      </div>
    </div>
  );
}

export function TodayView({ ledger, branch, openDate, onDateUsed }: {
  ledger: ReturnType<typeof useLedger>;
  branch: Branch;
  openDate: string | null;
  onDateUsed: () => void;
}) {
  const today = todayKL();
  const [date, setDate] = useState(openDate ?? today);

  useEffect(() => {
    if (openDate) onDateUsed();
  }, [openDate, onDateUsed]);

  const day = dayView(branch.opening_balance_sen, ledger.days, date);
  const beforeOpening = Boolean(branch.opening_date && date < branch.opening_date);
  const locked = beforeOpening || Boolean(ledger.months.find(m => m.period === periodOf(date))?.closed_at);

  return (
    <div className="stack">
      <div className="page-title">
        <div>
          <h1>Rekod harian</h1>
          <p className="muted">{longDateLabel(date)}</p>
        </div>
        <label className="date-field">
          <span>Tarikh</span>
          <input type="date" value={date} min={branch.opening_date ?? undefined} max={today} onChange={e => { if (e.target.value) setDate(e.target.value); }} />
        </label>
      </div>
      <DayPanel key={`${branch.id}:${date}`} branch={branch} date={date} day={day} days={ledger.days} locked={locked} beforeOpening={beforeOpening} onSave={ledger.saveTransaction} />
    </div>
  );
}
