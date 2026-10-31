'use client';
import { useState } from 'react';
import { Check, Copy, MessageCircle, Share2 } from 'lucide-react';
import { periodOf, periodRange, rangeReport, report, type Day } from '../lib/ledger';

function ReportContent({ branch, day, days, opening }: { branch: string; day: Day; days: Day[]; opening: number }) {
  const [mode, setMode] = useState<'compact' | 'detailed' | 'range'>('compact');
  const [from, setFrom] = useState(() => periodRange(periodOf(day.date)).start);
  const [to, setTo] = useState(day.date);
  const [status, setStatus] = useState('');
  const validRange = Boolean(from && to && from <= to);
  const text = mode === 'range' ? (validRange ? rangeReport(branch, opening, days, from, to) : '') : report(branch, day, mode);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Report disalin.');
    } catch {
      setStatus('Tak dapat salin automatik. Pilih teks di atas dan salin.');
    }
  }

  async function share() {
    try {
      await navigator.share({ text });
    } catch {
      // Cancelling the share sheet is not an error worth showing.
    }
  }

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Format report">
        <button type="button" aria-pressed={mode === 'compact'} onClick={() => setMode('compact')}>Ringkas</button>
        <button type="button" aria-pressed={mode === 'detailed'} onClick={() => setMode('detailed')}>Terperinci</button>
        <button type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>Ikut tarikh</button>
      </div>
      {mode === 'range' && (
        <div className="report-range">
          <label className="field"><span>Dari</span><input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field"><span>Hingga</span><input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        </div>
      )}
      {mode === 'range' && !validRange ? <div className="alert alert-error" role="alert">Tarikh Dari mesti sebelum atau sama dengan tarikh Hingga.</div> : <pre className="report-text">{text}</pre>}
      <div className="report-actions">
        <a className="btn btn-primary" aria-disabled={!text} href={text ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a>
        <button className="btn" disabled={!text} onClick={copy}><Copy size={17} /> Salin</button>
        {canShare && <button className="btn" disabled={!text} onClick={share}><Share2 size={17} /> Kongsi</button>}
      </div>
      {status && <p className="status-line" role="status"><Check size={14} /> {status}</p>}
    </div>
  );
}

export function ReportPanel({ branch, day, days, opening }: { branch: string; day: Day; days: Day[]; opening: number }) {
  return (
    <section className="card">
      <h2 className="card-title">Report untuk WhatsApp</h2>
      <ReportContent branch={branch} day={day} days={days} opening={opening} />
    </section>
  );
}
