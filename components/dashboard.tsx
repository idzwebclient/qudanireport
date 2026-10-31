'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildDays, fillPeriod, money, periodLabel, periodOf, periodRange, periodShortLabel, shiftPeriod, summarisePeriod, todayKL, type Day } from '../lib/ledger';
import { changeRatio, firstDays, monthlyTrend, netTarget, overallPerformance, periodStats, profitFor, quarterPeriods, rangeSummary, yearPeriods, type Insight } from '../lib/insights';
import type { Branch, Repo } from '../lib/repo';
import type { useLedger } from '../lib/use-ledger';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PeriodNav } from './period-nav';

const COLOR = { main: '#0b8a5f', second: '#c8650a', third: '#5b6fd6', grid: '#ececec', axis: '#6b7280' };
const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: COLOR.axis } };
const MARGIN = { top: 6, right: 4, left: -8, bottom: 0 };
const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, info: Info };
const RECOVERY_KEY = 'rekod:target-recovery-months';
const VIEWS = [['ringkasan', 'Ringkasan'], ['analisis', 'Analisis'], ['opex', 'OPEX'], ['modal', 'Modal']] as const;
type View = (typeof VIEWS)[number][0];
const RANGES = [['month', '1 Bulan'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['year', 'Setahun']] as const;
type Range = (typeof RANGES)[number][0];
type Column = { key: string; label: string; periods: string[]; total?: boolean };

const axisMoney = (ringgit: number) => (Math.abs(ringgit) >= 1000 ? `${(ringgit / 1000).toLocaleString('en-MY', { maximumFractionDigits: 1 })}k` : String(ringgit));
const tooltipMoney = (value: unknown) => money(Math.round(Number(value) * 100));
const shortDay = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
const percentOf = (ratio: number | null) => (ratio === null ? '–' : `${(ratio * 100).toFixed(1)}%`);

const percentCell = (now: number, before: number) => {
  const ratio = changeRatio(now, before);
  return ratio === null ? '–' : `${ratio >= 0 ? '+' : '−'}${Math.abs(ratio * 100).toFixed(0)}%`;
};
// A growing loss reads as a rise in the loss, matching its percentage.
const differenceCell = (now: number, before: number) => {
  if (now < 0 && before < 0) {
    const diff = Math.abs(now) - Math.abs(before);
    if (!diff) return money(0);
    return `Rugi ${diff >= 0 ? '+' : '-'}${money(Math.abs(diff))}`;
  }
  return `${now > before ? '+' : ''}${money(now - before)}`;
};

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const ratio = changeRatio(now, before);
  if (ratio === null) return <small className="delta"><Minus size={13} /> Tiada perbandingan</small>;
  const Icon = ratio > 0 ? ArrowUpRight : ratio < 0 ? ArrowDownRight : Minus;
  return <small className="delta"><Icon size={13} /> {now < 0 && before < 0 ? 'Rugi ' : ''}{Math.abs(ratio * 100).toFixed(0)}% berbanding {label}</small>;
}

function Note({ item }: { item: Insight }) {
  const Icon = TONE_ICON[item.tone];
  return <div className={`verdict verdict-${item.tone}`}><Icon size={20} /><b>{item.text}</b></div>;
}

function Bars({ data, dataKey, title, color, syncId, xKey = 'name' }: { data: object[]; dataKey: string; title: string; color: string; syncId?: string; xKey?: string }) {
  return (
    <figure className="mini-chart">
      <figcaption>{title}</figcaption>
      <div className="mini-box">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} syncId={syncId} margin={MARGIN} maxBarSize={44}>
            <CartesianGrid stroke={COLOR.grid} vertical={false} />
            <XAxis dataKey={xKey} {...axis} minTickGap={20} />
            <YAxis tickFormatter={axisMoney} {...axis} width={46} />
            <Tooltip formatter={tooltipMoney} cursor={{ fill: '#f4f4f4' }} />
            <Bar isAnimationActive={false} dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

type BranchRow = { branch: Branch; balance: number; purchases: number };

export function DashboardView({ ledger, branch, repo, onAdd, onMonth }: {
  ledger: ReturnType<typeof useLedger>;
  branch: Branch;
  repo: Repo;
  onAdd: () => void;
  onMonth: () => void;
}) {
  const today = todayKL();
  const [period, setPeriod] = useState(() => periodOf(today));
  const [view, setView] = useState<View>('ringkasan');
  const [range, setRange] = useState<Range>('month');
  const [year, setYear] = useState(() => Number(periodOf(today).slice(0, 4)));
  const [recovery, setRecovery] = useState(() => {
    try {
      return Number(localStorage.getItem(RECOVERY_KEY)) || 6;
    } catch {
      return 6;
    }
  });
  const [branchRows, setBranchRows] = useState<BranchRow[]>([]);
  const usable = ledger.branches.filter(b => !b.archived_at);

  const opening = branch.opening_balance_sen;
  const isMonth = range === 'month';
  const quarter = range.startsWith('q') ? Number(range[1]) : 0;
  const selected = isMonth ? [period] : quarter ? quarterPeriods(year, quarter) : yearPeriods(year);
  const previousAll = selected.map(p => shiftPeriod(p, -selected.length));
  const name = isMonth ? periodShortLabel(period) : quarter ? `Q${quarter}` : String(year);
  const previousName = isMonth ? periodShortLabel(previousAll[0]) : quarter ? (quarter === 1 ? `Q4 ${year - 1}` : `Q${quarter - 1}`) : String(year - 1);
  const rangeLabel = isMonth ? periodLabel(period) : `${name} ${quarter ? year : ''} · ${periodLabel(selected[0]).split(' – ')[0]} ${periodRange(selected[0]).start.slice(0, 4)} – ${periodLabel(selected.at(-1)!).split(' – ')[1]}`;

  const columns: Column[] = isMonth
    ? [shiftPeriod(period, -2), shiftPeriod(period, -1), period].map(p => ({ key: p, label: periodShortLabel(p), periods: [p] }))
    : quarter
      ? [...selected.map(p => ({ key: p, label: periodShortLabel(p), periods: [p] })), { key: 'total', label: `Jumlah ${name}`, periods: selected, total: true }]
      : [...[1, 2, 3, 4].map(q => ({ key: `q${q}`, label: `Q${q}`, periods: quarterPeriods(year, q) })), { key: 'total', label: `Jumlah ${year}`, periods: selected, total: true }];

  const sumOf = (periods: string[]) => rangeSummary(opening, ledger.days, ledger.months, periods, branch, today);
  const now = sumOf(selected);
  // Compare like with like: an unfinished range only against the same number of earlier months.
  const previous = sumOf(previousAll.slice(0, Math.max(now.months, 1)));
  // Factory results arrive month by month, so these compare only as many months as are entered.
  const previousFilledPeriods = previousAll.slice(0, Math.max(now.filledMonths, 1));
  const previousFilled = sumOf(previousFilledPeriods);
  const profitOf = (key: string) => profitFor(ledger.months, key, branch);
  const nowStats = periodStats(opening, ledger.days, period, today);
  const previousPeriod = previousAll[0];
  const like = isMonth && nowStats.inProgress ? firstDays(opening, ledger.days, previousPeriod, nowStats.elapsed) : previous;
  const trend = monthlyTrend(opening, ledger.days, ledger.months, today);
  const profit = profitOf(period);
  const target = netTarget({ trend, period, carried: profit.carried, recoveryMonths: recovery, stats: nowStats, shiftPeriod });
  const chartPeriods = isMonth ? columns.map(c => c.key) : selected.filter(p => p <= periodOf(today));
  const latest = [...chartPeriods].reverse().map(p => trend.find(r => r.period === p)).find(Boolean);

  function chooseRecovery(value: number) {
    setRecovery(value);
    try {
      localStorage.setItem(RECOVERY_KEY, String(value));
    } catch {}
  }

  // One table carries the month-by-month detail, so no other view repeats these figures.
  const filledValue = (periods: string[], pick: (r: ReturnType<typeof sumOf>) => number | null) => {
    const r = sumOf(periods);
    return r.filledMonths ? pick(r) : null;
  };
  const rows: { label: string; value: (periods: string[]) => number | null; before?: number; strong?: boolean; percent?: boolean }[] = [
    { label: 'Belian', value: p => (sumOf(p).started ? sumOf(p).purchases : null), before: like.purchases },
    { label: 'Untung / rugi kasar', value: p => filledValue(p, r => r.gross) },
    { label: 'Margin kasar', value: p => filledValue(p, r => r.margin), percent: true },
    { label: 'Kos marketing', value: p => filledValue(p, r => r.marketing) },
    { label: 'Marketing ÷ belian', value: p => filledValue(p, r => r.marketingRatio), percent: true },
    { label: 'OPEX', value: p => filledValue(p, r => r.opex) },
    { label: 'Untung / rugi', value: p => filledValue(p, r => r.own) },
    { label: 'Terkumpul', value: p => (sumOf(p).started ? sumOf(p).final : null), before: sumOf(previousAll).final, strong: true },
  ];

  const chart = chartPeriods.map(key => ({
    name: periodShortLabel(key),
    Belian: sumOf([key]).purchases / 100,
    'Kos marketing': sumOf([key]).marketing / 100,
    'Untung kasar': sumOf([key]).gross / 100,
  }));
  const overall = overallPerformance(trend.filter(r => isMonth || selected.includes(r.period)));

  const opexItems = (p: string) => ledger.months.find(m => m.period === p)?.opex ?? [];
  const opexTotal = (periods: string[], itemName: string) => periods.flatMap(opexItems).filter(o => o.label.trim() === itemName).reduce((sum, o) => sum + o.amount_sen, 0);
  const allColumnPeriods = columns.flatMap(c => c.periods);
  const opexBase = isMonth ? (profit.filled ? [period] : [previousPeriod]) : selected;
  const opexNames = [...new Set(allColumnPeriods.flatMap(p => opexItems(p).map(o => o.label.trim())))].sort((a, b) => opexTotal(opexBase, b) - opexTotal(opexBase, a));
  const opexTop = Math.max(1, ...opexNames.map(item => opexTotal(opexBase, item)));

  const filledDays = selected.flatMap(p => fillPeriod(opening, ledger.days, p, today));
  const totalOut = now.purchases + now.costs + now.otherCosts + now.returned + now.passed;

  const branchKey = usable.map(b => b.id).join() + selected.join() + ledger.days.at(-1)?.balance;
  useEffect(() => {
    if (usable.length < 2 || !ledger.online) return;
    let live = true;
    Promise.all(usable.map(async b => {
      const days: Day[] = buildDays(b.opening_balance_sen, await repo.listTransactions(b.id), b.opening_date);
      return { branch: b, balance: days.at(-1)?.balance ?? b.opening_balance_sen, purchases: selected.reduce((total, p) => total + summarisePeriod(b.opening_balance_sen, days, p).purchases, 0) };
    })).then(list => { if (live) setBranchRows(list); }).catch(() => {});
    return () => { live = false; };
    // branchKey stands in for `usable`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey, repo, ledger.online]);

  const targetNote = (): Insight | null => {
    if (!target) return null;
    if (profit.filled) {
      return profit.own >= target.target
        ? { tone: 'good', text: `Target tercapai: ${money(profit.own)} berbanding ${money(target.target)}.` }
        : { tone: 'warn', text: `Target belum tercapai: ${money(profit.own)} berbanding ${money(target.target)}.` };
    }
    if (target.volumeUnrealistic) {
      return { tone: 'warn', text: `Belian sahaja tak realistik untuk capai target. Perlu naikkan margin atau kurangkan kos marketing per belian (${percentOf(target.marketingRatio)}).` };
    }
    if (!target.projectionReliable) {
      return { tone: 'info', text: `Baru ${target.recordedDays} hari ada rekod. ${target.neededPerDay !== null ? `Perlu belian ${money(target.neededPerDay)} sehari untuk capai target.` : ''}` };
    }
    return target.projectedNet >= target.target
      ? { tone: 'good', text: `Atas landasan: belian dijangka ${money(target.projectedPurchases)} bulan ini.` }
      : { tone: 'warn', text: `Di bawah target: belian dijangka ${money(target.projectedPurchases)}.${target.neededPerDay !== null ? ` Perlu ${money(target.neededPerDay)} sehari.` : ''}` };
  };
  const status = targetNote();

  return (
    <div className="stack">
      <div className="page-title">
        <div><h1>Dashboard</h1><p className="muted">{branch.name}</p></div>
        <button className="btn btn-primary mobile-only" onClick={onAdd}>Isi rekod hari ini</button>
      </div>

      <div className="filter-bar range-bar">
        <div className="segmented range-tabs" role="group" aria-label="Tempoh paparan">
          {RANGES.map(([id, label]) => <button key={id} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>)}
        </div>
        {isMonth ? <PeriodNav period={period} onChange={setPeriod} /> : (
          <div className="datebar">
            <button className="icon-btn" aria-label="Tahun sebelumnya" onClick={() => setYear(year - 1)}><ChevronLeft size={20} /></button>
            <div className="date-picker"><span>{rangeLabel}</span></div>
            <button className="icon-btn" aria-label="Tahun seterusnya" onClick={() => setYear(year + 1)}><ChevronRight size={20} /></button>
          </div>
        )}
      </div>

      <div className="segmented view-tabs" role="group" aria-label="Bahagian Dashboard">
        {VIEWS.map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
      </div>

      {view === 'ringkasan' && (
        <>
          <div className="headline-grid">
            <div className="kpi">
              <span>Belian {name}</span>
              <strong>{money(now.purchases)}</strong>
              <Delta now={now.purchases} before={like.purchases} label={isMonth && nowStats.inProgress ? `${nowStats.elapsed} hari pertama ${previousName}` : previousName} />
            </div>
            <div className="kpi">
              <span>{!now.filledMonths ? `Untung / rugi ${name}` : now.own < 0 ? `Rugi ${name}` : `Untung ${name}`}</span>
              <strong className={now.own < 0 ? 'negative' : undefined}>{now.filledMonths ? money(now.own) : 'Belum isi'}</strong>
              {now.filledMonths ? <Delta now={now.own} before={previousFilled.own} label={previousName} /> : <button className="link-btn" onClick={onMonth}>Isi di Bulanan selepas jual kilang</button>}
              {!isMonth && now.filledMonths > 0 && now.filledMonths < selected.length && <small className="delta">{now.filledMonths} daripada {selected.length} bulan diisi</small>}
            </div>
            <div className="kpi">
              <span>{now.final < 0 ? 'Rugi terkumpul' : 'Untung terkumpul'}</span>
              <strong className={now.final < 0 ? 'negative' : undefined}>{money(now.final)}</strong>
              <small className="delta">Sampai {periodShortLabel(selected.filter(p => p <= periodOf(today)).at(-1) ?? selected[0])}, termasuk bulan lepas</small>
            </div>
          </div>

          {isMonth && <section className="card stack">
            <div className="target-head">
              <h2 className="card-title">Target untung bersih {name}</h2>
              {profit.carried > 0 && (
                <label className="compare-select target-select">
                  <span>Tampung rugi dalam</span>
                  <select value={recovery} onChange={e => chooseRecovery(Number(e.target.value))}>
                    {[3, 6, 12, 18, 24].map(n => <option key={n} value={n}>{n} bulan</option>)}
                  </select>
                </label>
              )}
            </div>
            {target ? (
              <>
                <div className="target-main">
                  <div><span>Target</span><strong>{money(target.target)}</strong></div>
                  <div><span>Perlu margin</span><strong>{percentOf(target.neededMargin)}</strong><small>Sekarang {percentOf(target.avgMargin)}, pada belian {money(target.avgPurchases)}</small></div>
                  <div><span>Atau perlu belian</span><strong>{target.neededPurchases === null ? 'Tak tercapai' : money(target.neededPurchases)}</strong><small>Baki selepas marketing {percentOf(target.marginAfterMarketing)}, purata {money(target.avgPurchases)}</small></div>
                </div>
                {status && <Note item={status} />}
                <details className="how">
                  <summary>Cara kira</summary>
                  <p className="muted">Guna {target.count} bulan lengkap sebelum {name} ({periodShortLabel(target.baseFrom)}{target.count > 1 ? ` – ${periodShortLabel(target.baseTo)}` : ''}). {profit.carried > 0 ? `Target = rugi dibawa ${money(profit.carried)} ÷ ${recovery} bulan.` : 'Target = purata untung bersih + 10%.'} Perlu margin = (target + purata marketing dan OPEX {money(target.avgCost)}) ÷ purata belian. Perlu belian = (target + purata OPEX {money(target.avgOpex)}) ÷ baki selepas marketing, dengan marketing naik seiring belian pada {percentOf(target.marketingRatio)}. Pulang kos sahaja perlukan belian {target.breakEvenPurchases === null ? 'yang tak tercapai' : money(target.breakEvenPurchases)}. {target.marketingLimit >= 0 ? `Pada belian dan margin sekarang, marketing mesti tak lebih ${money(target.marketingLimit)} sebulan.` : `Pada belian dan margin sekarang, target tak tercapai walaupun marketing RM0.`}</p>
                </details>
              </>
            ) : <p className="muted">Keluar selepas ada sekurang-kurangnya satu bulan lengkap sebelum {name}.</p>}
          </section>}

          <section className="card card-scroll">
            <h2 className="card-title">{isMonth ? 'Perbandingan 3 bulan' : `Perbandingan ${name}`}</h2>
            <table className="compare-table compare-main">
              <thead><tr><th />{columns.map(c => <th key={c.key}>{c.label}</th>)}<th>Beza {name} vs {previousName}</th><th>%</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const current = r.value(selected);
                  const before = r.before ?? r.value(previousFilledPeriods);
                  const comparable = current !== null && before !== null && !r.percent;
                  return (
                    <tr key={r.label} className={r.strong ? 'compare-total' : undefined}>
                      <th scope="row">{r.label}</th>
                      {columns.map(c => {
                        const value = r.value(c.periods);
                        const cls = c.total ? 'cell-strong' : undefined;
                        if (r.percent) return <td key={c.key} className={c.total ? 'cell-strong' : 'cell-soft'}>{percentOf(value)}</td>;
                        return <td key={c.key} className={[cls, value !== null && value < 0 ? 'negative' : ''].filter(Boolean).join(' ') || undefined}>{value === null ? <span className="cell-soft">{sumOf(c.periods).started ? 'Belum isi' : '–'}</span> : money(value)}</td>;
                      })}
                      <td>{comparable ? differenceCell(current, before) : '–'}</td>
                      <td>{comparable ? percentCell(current, before) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {isMonth && nowStats.inProgress && <p className="muted compare-note">{name} masih berjalan ({nowStats.elapsed} hari). Beza belian guna {nowStats.elapsed} hari pertama {previousName}.</p>}
            {!isMonth && now.started && now.months < selected.length && <p className="muted compare-note">{name} belum tamat. Belian dibanding dengan {now.months} bulan pertama {previousName}, dan untung serta kos dengan {Math.max(now.filledMonths, 1)} bulan pertama.</p>}
          </section>
        </>
      )}

      {view === 'analisis' && (
        <>
          <section className="card stack">
            <div>
              <h2 className="card-title">Marketing vs belian</h2>
              <p className="muted">Bila marketing naik, adakah belian ikut naik?</p>
            </div>
            {latest?.marketingVerdict ? <Note item={{ ...latest.marketingVerdict, text: `${periodShortLabel(latest.period)}: ${latest.marketingVerdict.text}` }} /> : <p className="muted">Perlu dua bulan lengkap untuk dibanding.</p>}
            <div className="mini-grid">
              <Bars data={chart} dataKey="Kos marketing" title="Kos marketing (RM)" color={COLOR.second} syncId="marketing" />
              <Bars data={chart} dataKey="Belian" title="Belian (RM)" color={COLOR.main} syncId="marketing" />
            </div>
          </section>

          <section className="card stack">
            <div>
              <h2 className="card-title">Belian vs untung kasar</h2>
              <p className="muted">Bila belian naik, adakah untung kasar ikut naik?</p>
            </div>
            {latest?.grossVerdict ? <Note item={{ ...latest.grossVerdict, text: `${periodShortLabel(latest.period)}: ${latest.grossVerdict.text}` }} /> : <p className="muted">Perlu dua bulan lengkap untuk dibanding.</p>}
            <div className="mini-grid">
              <Bars data={chart} dataKey="Belian" title="Belian (RM)" color={COLOR.main} syncId="gross" />
              <Bars data={chart} dataKey="Untung kasar" title="Untung kasar (RM)" color={COLOR.third} syncId="gross" />
            </div>
          </section>

          <section className="card stack">
            <div>
              <h2 className="card-title">Prestasi keseluruhan</h2>
              <p className="muted">{overall.months ? `${overall.months} bulan lengkap, ${periodShortLabel(overall.first)} – ${periodShortLabel(overall.last)}${isMonth ? ', semua data' : ''}. Tanpa untung / rugi permulaan.` : 'Belum ada bulan lengkap.'}</p>
            </div>
            <div className="stat-row overall-grid">
              <div><span>Jumlah belian</span><b>{money(overall.purchases)}</b></div>
              <div><span>Jumlah untung kasar</span><b>{money(overall.gross)}</b></div>
              <div><span>Jumlah marketing</span><b>{money(overall.marketing)}</b></div>
              <div><span>Jumlah OPEX</span><b>{money(overall.opex)}</b></div>
              <div><span>{overall.net < 0 ? 'Jumlah rugi' : 'Jumlah untung'}</span><b className={overall.net < 0 ? 'negative' : undefined}>{money(overall.net)}</b></div>
              <div><span>Margin purata</span><b>{percentOf(overall.margin)}</b></div>
            </div>
          </section>
        </>
      )}

      {view === 'opex' && (
        <section className="card card-scroll">
          <h2 className="card-title">OPEX {isMonth ? '3 bulan' : name}</h2>
          {opexNames.length ? (
            <table className="compare-table compare-main opex-table">
              <thead><tr><th>Item</th><th aria-hidden="true" />{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {opexNames.map(item => (
                  <tr key={item}>
                    <th scope="row">{item}</th>
                    <td className="opex-bar" aria-hidden="true"><i><em style={{ width: `${(opexTotal(opexBase, item) / opexTop) * 100}%` }} /></i></td>
                    {columns.map(c => <td key={c.key} className={c.total ? 'cell-strong' : undefined}>{sumOf(c.periods).filledMonths ? money(opexTotal(c.periods, item)) : '–'}</td>)}
                  </tr>
                ))}
                <tr className="compare-total">
                  <th scope="row">Jumlah</th>
                  <td className="opex-bar" aria-hidden="true" />
                  {columns.map(c => <td key={c.key}>{sumOf(c.periods).filledMonths ? money(sumOf(c.periods).opex) : '–'}</td>)}
                </tr>
              </tbody>
            </table>
          ) : <p className="empty">Belum ada item OPEX. <button className="link-btn" onClick={onMonth}>Isi di Bulanan</button></p>}
        </section>
      )}

      {view === 'modal' && (
        <>
          <div className="stat-row overall-grid">
            <div><span>Baki modal</span><b className={now.balance < 0 ? 'negative' : undefined}>{money(now.balance)}</b></div>
            <div><span>Modal awal {name}</span><b>{money(now.startBalance)}</b></div>
            <div><span>Modal masuk</span><b>{money(now.capitalIn)}</b></div>
            <div><span>Jumlah keluar</span><b>{money(totalOut)}</b></div>
            <div><span>Kos harian</span><b>{money(now.costs)}</b></div>
            <div><span>Pulang / pass</span><b>{money(now.returned + now.passed)}</b></div>
          </div>
          <section className="card stack">
            <figure className="mini-chart">
              <figcaption>Baki modal setiap hari (RM)</figcaption>
              <div className="mini-box">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={filledDays.map(d => ({ day: shortDay(d.date), baki: d.balance / 100 }))} margin={MARGIN}>
                    <CartesianGrid stroke={COLOR.grid} vertical={false} />
                    <XAxis dataKey="day" {...axis} minTickGap={24} />
                    <YAxis tickFormatter={axisMoney} {...axis} width={46} />
                    <Tooltip formatter={tooltipMoney} />
                    <Area isAnimationActive={false} type="linear" dataKey="baki" name="Baki" stroke={COLOR.main} strokeWidth={2} fill={COLOR.main} fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </figure>
            <Bars data={filledDays.map(d => ({ day: shortDay(d.date), Belian: d.purchases / 100 }))} dataKey="Belian" xKey="day" title="Belian setiap hari (RM)" color={COLOR.main} />
          </section>
          {usable.length > 1 && (
            <section className="card card-scroll">
              <h2 className="card-title">Semua cawangan</h2>
              {branchRows.length ? (
                <table className="compare-table">
                  <thead><tr><th>Cawangan</th><th>Belian {name}</th><th>Baki modal</th></tr></thead>
                  <tbody>
                    {branchRows.map(r => (
                      <tr key={r.branch.id} className={r.branch.id === branch.id ? 'compare-current' : undefined}>
                        <th scope="row"><button className="link-btn" onClick={() => void ledger.switchBranch(r.branch.id)}>{r.branch.name}</button></th>
                        <td>{money(r.purchases)}</td>
                        <td className={r.balance < 0 ? 'negative' : undefined}>{money(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted">{ledger.online ? 'Memuatkan…' : 'Perlu sambungan internet.'}</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
