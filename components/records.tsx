'use client';
import { useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { dateLabel, money, periodCsv, periodOf, periodRange, summariseRange, todayKL } from '../lib/ledger';
import type { Branch } from '../lib/repo';
import type { useLedger } from '../lib/use-ledger';
import { PeriodNav } from './period-nav';

export function RecordsView({ ledger, branch, onOpenDay }: {
  ledger: ReturnType<typeof useLedger>;
  branch: Branch;
  onOpenDay: (date: string) => void;
}) {
  const [period, setPeriod] = useState(() => periodOf(todayKL()));
  const [range, setRange] = useState(() => periodRange(periodOf(todayKL())));
  const { start, end } = range;
  const validRange = Boolean(start && end && start <= end);
  const fullPeriod = periodRange(period);
  const isFullPeriod = start === fullPeriod.start && end === fullPeriod.end;
  const summary = summariseRange(branch.opening_balance_sen, ledger.days, start, validRange ? end : start);

  function changePeriod(next: string) {
    setPeriod(next);
    setRange(periodRange(next));
  }

  const hasOther = summary.otherCosts > 0;

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([periodCsv(branch.name, summary.rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `rekod-modal-${start}-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <div className="page-title"><div><h1>Sejarah</h1><p className="muted">Tekan satu hari untuk buka rekodnya.</p></div></div>
      <div className="page-head">
        <PeriodNav period={period} onChange={changePeriod} label={isFullPeriod ? undefined : 'Tarikh pilihan'} />
        <button className="btn" disabled={!validRange || !summary.rows.length} onClick={exportCsv}><Download size={16} /> CSV</button>
      </div>
      <div className="report-range">
        <label className="field"><span>Dari</span><input type="date" value={start} min={branch.opening_date ?? undefined} max={end || undefined} onChange={e => setRange({ start: e.target.value, end })} /></label>
        <label className="field"><span>Hingga</span><input type="date" value={end} min={start || branch.opening_date || undefined} onChange={e => setRange({ start, end: e.target.value })} /></label>
      </div>
      {!validRange && <div className="alert alert-error" role="alert">Tarikh Dari mesti sebelum atau sama dengan tarikh Hingga.</div>}

      {validRange && <div className="stat-row">
        <div><span>Modal awal</span><b>{money(summary.startBalance)}</b></div>
        <div><span>Modal masuk</span><b>{money(summary.capitalIn)}</b></div>
        <div><span>Belian + kos</span><b>{money(summary.purchases + summary.costs + summary.otherCosts)}</b></div>
        <div><span>Baki akhir</span><b>{money(summary.balance)}</b></div>
      </div>}

      {validRange && <section className="card card-flush">
        {validRange && summary.rows.length ? (
          <table className="records">
            <thead>
              <tr>
                <th>Tarikh</th><th>Modal awal</th><th>Modal masuk</th><th>Belian</th><th>Kos</th>
                {hasOther && <th>Lain-lain kos</th>}
                <th>Pulang / pass modal</th><th>Baki modal</th><th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {[...summary.rows].reverse().map(r => (
                <tr key={r.date} onClick={() => onOpenDay(r.date)}>
                  <th scope="row"><button onClick={() => onOpenDay(r.date)}>{dateLabel(r.date)}</button></th>
                  <td data-label="Modal awal">{money(r.start)}</td>
                  <td data-label="Modal masuk">{money(r.capitalIn)}</td>
                  <td data-label="Belian">{money(r.purchases)}</td>
                  <td data-label="Kos">{money(r.costs)}</td>
                  {hasOther && <td data-label="Lain-lain kos">{money(r.otherCosts)}</td>}
                  <td data-label="Pulang / pass modal">{money(r.returned + r.passed)}</td>
                  <td data-label="Baki modal" className={r.balance < 0 ? 'records-balance negative' : 'records-balance'}>{money(r.balance)}</td>
                  <td className="cell-chevron" aria-hidden="true"><ChevronRight size={16} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Jumlah</th>
                <td data-label="Modal awal">{money(summary.startBalance)}</td>
                <td data-label="Modal masuk">{money(summary.capitalIn)}</td>
                <td data-label="Belian">{money(summary.purchases)}</td>
                <td data-label="Kos">{money(summary.costs)}</td>
                {hasOther && <td data-label="Lain-lain kos">{money(summary.otherCosts)}</td>}
                <td data-label="Pulang / pass modal">{money(summary.returned + summary.passed)}</td>
                <td data-label="Baki modal" className={summary.balance < 0 ? 'records-balance negative' : 'records-balance'}>{money(summary.balance)}</td>
                <td className="cell-chevron" aria-hidden="true" />
              </tr>
            </tfoot>
          </table>
        ) : <p className="empty">Tiada rekod dalam tempoh ini.</p>}
      </section>}
    </div>
  );
}
