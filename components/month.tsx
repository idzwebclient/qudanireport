'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { money, parseSen, periodOf, periodRange, senToInput, summarisePeriod, todayKL } from '../lib/ledger';
import { profitFor } from '../lib/insights';
import type { Branch, Month, OpexCategory, Repo } from '../lib/repo';
import type { useLedger } from '../lib/use-ledger';
import { AmountInput } from './amount-input';
import { PeriodNav } from './period-nav';

const NEW_ITEM = '__new__';

export const netOf = (m?: Month) => (m ? m.gross_profit_sen - m.marketing_sen - m.opex.reduce((total, o) => total + o.amount_sen, 0) : 0);

type Row = { key: string; label: string; amount: string; adding?: boolean; newName?: string };

function MonthForm({ branch, repo, period, month, carried, categories, onChanged, disabled }: {
  branch: Branch;
  repo: Repo;
  period: string;
  month?: Month;
  carried: number;
  categories: OpexCategory[];
  onChanged: () => Promise<void>;
  disabled: boolean;
}) {
  const [gross, setGross] = useState(senToInput(Math.abs(month?.gross_profit_sen ?? 0)));
  const [grossLoss, setGrossLoss] = useState((month?.gross_profit_sen ?? 0) < 0);
  const [marketing, setMarketing] = useState(senToInput(month?.marketing_sen ?? 0));
  const [notes, setNotes] = useState(month?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => (month?.opex ?? []).map(o => ({ key: o.id, label: o.label, amount: senToInput(o.amount_sen) })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const closed = Boolean(month?.closed_at);
  const canEdit = branch.role === 'owner' && !closed && !disabled;
  const update = (key: string, patch: Partial<Row>) => {
    setRows(rows.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setMessage(null);
  };

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await onChanged();
      setMessage({ ok: true, text: done });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function createItem(row: Row) {
    const name = (row.newName ?? '').trim();
    if (!name) return;
    const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      setBusy(true);
      try {
        await repo.addOpexCategory(branch.id, name);
        await onChanged();
      } catch (err) {
        setMessage({ ok: false, text: (err as Error).message });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    update(row.key, { label: existing?.name ?? name, adding: false, newName: '' });
  }

  function save() {
    const grossSen = gross.trim() ? parseSen(gross) : 0;
    const marketingSen = marketing.trim() ? parseSen(marketing) : 0;
    const items = rows.filter(r => r.label.trim() || r.amount.trim()).map(r => ({ label: r.label.trim(), amount_sen: parseSen(r.amount) }));
    if (rows.some(r => r.adding)) {
      setMessage({ ok: false, text: 'Tekan Cipta atau Batal pada item baru dahulu.' });
      return;
    }
    if (grossSen === null || marketingSen === null || items.some(i => i.amount_sen === null || !i.label)) {
      setMessage({ ok: false, text: 'Pilih nama dan semak amaun setiap item.' });
      return;
    }
    void run(() => repo.saveMonth(branch.id, period, grossLoss ? -grossSen : grossSen, notes, items as { label: string; amount_sen: number }[], marketingSen), 'Data bulan disimpan.');
  }

  return (
    <section className="card stack">
      <h2 className="card-title">Untung & perbelanjaan</h2>
      <div className="segmented" role="group" aria-label="Keputusan jual kilang">
        <button type="button" disabled={!canEdit} aria-pressed={!grossLoss} onClick={() => { setGrossLoss(false); setMessage(null); }}>Untung kasar</button>
        <button type="button" disabled={!canEdit} aria-pressed={grossLoss} onClick={() => { setGrossLoss(true); setMessage(null); }}>Rugi kasar</button>
      </div>
      <AmountInput label={`${grossLoss ? 'Rugi' : 'Untung'} kasar (jual kilang − belian)`} value={gross} onChange={v => { setGross(v); setMessage(null); }} disabled={!canEdit} />
      <AmountInput label="Kos marketing (iklan)" value={marketing} onChange={v => { setMarketing(v); setMessage(null); }} disabled={!canEdit} />
      {rows.some(r => /iklan|marketing/i.test(r.label)) && (
        <div className="alert alert-warn">Ada item OPEX bernama iklan atau marketing. Masukkan amaun itu dalam Kos marketing di atas dan buang item ini supaya tak ditolak dua kali.</div>
      )}
      <div className="opex">
        <span className="field-label">Item OPEX</span>
        {rows.map((r, i) => (
          <div className="opex-row" key={r.key}>
            {r.adding ? (
              <div className="opex-new">
                <input autoFocus aria-label="Nama item baru" placeholder="Nama item baru" maxLength={120} value={r.newName ?? ''} onChange={e => update(r.key, { newName: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void createItem(r); }} />
                <button className="btn btn-small" disabled={busy || !(r.newName ?? '').trim()} onClick={() => void createItem(r)}>Cipta</button>
                <button className="btn btn-small" onClick={() => update(r.key, { adding: false, newName: '' })}>Batal</button>
              </div>
            ) : (
              <select aria-label={`Nama item ${i + 1}`} value={r.label} disabled={!canEdit} onChange={e => update(r.key, e.target.value === NEW_ITEM ? { adding: true } : { label: e.target.value })}>
                <option value="">Pilih item…</option>
                {[...new Set([...categories.map(c => c.name), ...(r.label ? [r.label] : [])])].sort((a, b) => a.localeCompare(b)).map(name => (
                  <option key={name} value={name} disabled={name !== r.label && rows.some(x => x.label === name)}>{name}</option>
                ))}
                <option value={NEW_ITEM}>+ Cipta item baru…</option>
              </select>
            )}
            <input aria-label={`Amaun item ${i + 1}`} placeholder="0.00" inputMode="decimal" value={r.amount} disabled={!canEdit} onChange={e => update(r.key, { amount: e.target.value })} />
            {canEdit && <button className="icon-btn" aria-label={`Buang item ${i + 1}`} onClick={() => setRows(rows.filter(x => x.key !== r.key))}><Trash2 size={17} /></button>}
          </div>
        ))}
        {!rows.length && <p className="empty empty-small">Belum ada item OPEX.</p>}
        {canEdit && <button className="btn btn-small" onClick={() => setRows([...rows, { key: crypto.randomUUID(), label: '', amount: '' }])}><Plus size={15} /> Tambah item</button>}
      </div>
      {carried !== 0 && (
        <div className="carried-row"><span>{carried > 0 ? 'Rugi' : 'Untung'} dibawa masuk<small>Dikira automatik daripada tempoh lepas dan Tetapan. Tak perlu masukkan sebagai OPEX.</small></span><b>{money(Math.abs(carried))}</b></div>
      )}
      {carried > 0 && rows.some(r => /rugi/i.test(r.label)) && (
        <div className="alert alert-warn">Ada item OPEX bernama “rugi”. Rugi tempoh lepas kini dibawa automatik, jadi buang item ini supaya tak ditolak dua kali.</div>
      )}
      <label className="field">
        <span>Catatan</span>
        <textarea maxLength={1000} rows={3} value={notes} disabled={!canEdit} onChange={e => setNotes(e.target.value)} />
      </label>
      {message && <div className={`alert ${message.ok ? 'alert-ok' : 'alert-error'}`} role="status">{message.text}</div>}
      {branch.role === 'owner' ? (
        <div className="sheet-actions">
          {!closed && <button className="btn btn-primary" disabled={!canEdit || busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button>}
          <button className="btn" disabled={busy || disabled} onClick={() => void run(() => repo.setMonthClosed(branch.id, period, !closed), closed ? 'Bulan dibuka semula.' : 'Bulan ditutup. Rekod dalam tempoh ini kini dikunci.')}>
            {closed ? <><LockOpen size={16} /> Buka semula</> : <><Lock size={16} /> Tutup bulan</>}
          </button>
        </div>
      ) : <p className="muted">Hanya pemilik cawangan boleh mengubah data bulanan.</p>}
      {disabled && <p className="muted">Perlu sambungan internet untuk mengubah data bulanan.</p>}
    </section>
  );
}

export function MonthView({ ledger, branch, repo }: { ledger: ReturnType<typeof useLedger>; branch: Branch; repo: Repo }) {
  const [period, setPeriod] = useState(() => periodOf(todayKL()));
  const [serverBalance, setServerBalance] = useState<{ key: string; value: number | null } | null>(null);
  const month = ledger.months.find(m => m.period === period);
  const summary = summarisePeriod(branch.opening_balance_sen, ledger.days, period);
  const gross = month?.gross_profit_sen ?? 0, opex = (month?.opex ?? []).reduce((t, o) => t + o.amount_sen, 0);
  const profit = profitFor(ledger.months, period, branch);
  const { end } = periodRange(period);
  const checkKey = `${branch.id}:${period}:${summary.balance}:${ledger.pendingCount}`;

  // A real reconciliation: the app's own total against the database's running balance.
  useEffect(() => {
    if (!ledger.online || ledger.pendingCount) return;
    let live = true;
    repo.serverBalance(branch.id, end)
      .then(value => { if (live) setServerBalance({ key: checkKey, value: value ?? branch.opening_balance_sen }); })
      .catch(() => {});
    return () => { live = false; };
  }, [repo, branch.id, branch.opening_balance_sen, end, checkKey, ledger.online, ledger.pendingCount]);

  const checked = serverBalance?.key === checkKey ? serverBalance.value : undefined;
  const matches = checked === summary.balance;

  return (
    <div className="stack">
      <div className="page-title"><div><h1>Bulanan</h1><p className="muted">Isi untung dan perbelanjaan, kemudian tutup bulan.</p></div></div>
      <PeriodNav period={period} onChange={setPeriod} />
      {month?.closed_at && <div className="alert alert-warn"><Lock size={16} /> Tempoh ini telah ditutup.</div>}

      <div className="stat-row stat-row-wide">
        <div><span>{!profit.filled ? 'Untung / rugi bulan ini' : profit.own < 0 ? 'Rugi bulan ini' : 'Untung bulan ini'}</span><b className={profit.own < 0 ? 'negative' : undefined}>{profit.filled ? money(profit.own) : 'Belum diisi'}</b></div>
        <div><span>{profit.final < 0 ? 'Rugi terkumpul' : 'Untung terkumpul'}</span><b className={profit.final < 0 ? 'negative' : undefined}>{money(profit.final)}</b></div>
        <div><span>{gross < 0 ? 'Rugi kasar' : 'Untung kasar'}</span><b className={gross < 0 ? 'negative' : undefined}>{money(gross)}</b></div>
        <div><span>Kos marketing</span><b>{money(month?.marketing_sen ?? 0)}</b></div>
        <div><span>OPEX</span><b>{money(opex)}</b></div>
        <div><span>Baki modal</span><b>{money(summary.balance)}</b></div>
      </div>

      <div className="month-grid">
        <MonthForm key={`${branch.id}:${period}:${month?.closed_at ?? ''}`} branch={branch} repo={repo} period={period} month={month} carried={profit.carried} categories={ledger.categories} onChanged={ledger.refresh} disabled={!ledger.online} />
        <div className="stack">
          <section className="card stack">
            <h2 className="card-title">Semakan modal</h2>
            <dl className="equation">
              <div><dt>Modal awal</dt><dd>{money(summary.startBalance)}</dd></div>
              <div><dt>+ Modal masuk</dt><dd>{money(summary.capitalIn)}</dd></div>
              <div><dt>− Belian</dt><dd>{money(summary.purchases)}</dd></div>
              <div><dt>− Kos</dt><dd>{money(summary.costs)}</dd></div>
              {summary.otherCosts > 0 && <div><dt>− Lain-lain kos</dt><dd>{money(summary.otherCosts)}</dd></div>}
              <div><dt>− Pulang modal</dt><dd>{money(summary.returned)}</dd></div>
              <div><dt>− Pass modal</dt><dd>{money(summary.passed)}</dd></div>
              <div className="equation-total"><dt>Baki akhir</dt><dd>{money(summary.balance)}</dd></div>
            </dl>
            {checked === undefined ? (
              <p className="muted">{ledger.online ? 'Menyemak dengan database…' : 'Tak boleh disemak semasa offline.'}</p>
            ) : matches ? (
              <p className="check check-ok"><CheckCircle2 size={16} /> Sepadan dengan database</p>
            ) : (
              <p className="check check-bad"><AlertTriangle size={16} /> Tak sepadan: database {money(checked ?? 0)}. Muat semula dan semak.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
