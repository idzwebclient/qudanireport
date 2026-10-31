import { addDays, fillPeriod, periodOf, periodRange, summarisePeriod, type Day } from './ledger.ts';

export type PeriodStats = ReturnType<typeof periodStats>;
export type Insight = { tone: 'good' | 'warn' | 'info'; text: string };
export type MonthFigures = { period: string; gross_profit_sen: number; marketing_sen?: number; opex: { amount_sen: number }[] };
export type Profit = ReturnType<typeof profitFor>;
export type OpeningProfit = { opening_pl_sen: number; opening_pl_date: string | null };

const opexOf = (m: MonthFigures) => m.opex.reduce((total, o) => total + o.amount_sen, 0);
const ownProfit = (m: MonthFigures) => m.gross_profit_sen - (m.marketing_sen ?? 0) - opexOf(m);

// A loss carries into following periods until profit has covered it. Ordinary profit does not carry.
// An opening figure summarises everything up to its date, so the chain restarts from it: earlier
// months no longer carry, and the figure lands in the period after that date.
// `carried` is positive for a loss brought in and negative for a profit brought in.
export function profitFor(months: MonthFigures[], period: string, opening?: OpeningProfit) {
  const start = opening?.opening_pl_sen && opening.opening_pl_date ? periodOf(addDays(opening.opening_pl_date, 1)) : null;
  const useOpening = Boolean(start && period >= start);
  let carried = useOpening ? -opening!.opening_pl_sen : 0;
  const earlier = [...months]
    .filter(m => m.period < period && (!useOpening || m.period >= start!))
    .sort((a, b) => a.period.localeCompare(b.period));
  for (const m of earlier) {
    const final = ownProfit(m) - carried;
    carried = final < 0 ? -final : 0;
  }
  const month = months.find(m => m.period === period);
  const own = month ? ownProfit(month) : 0;
  return { filled: Boolean(month), gross: month?.gross_profit_sen ?? 0, opex: month ? opexOf(month) : 0, marketing: month?.marketing_sen ?? 0, own, carried, final: own - carried };
}

export function periodStats(opening: number, days: Day[], period: string, today: string) {
  const summary = summarisePeriod(opening, days, period);
  const elapsed = fillPeriod(opening, days, period, today).length;
  const { start, end } = periodRange(period);
  const fullLength = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const top = summary.rows.reduce<Day | null>((best, r) => (r.purchases > (best?.purchases ?? 0) ? r : best), null);
  return {
    ...summary,
    elapsed,
    recorded: summary.rows.length,
    inProgress: elapsed > 0 && elapsed < fullLength,
    fullLength,
    costRatio: summary.purchases ? summary.costs / summary.purchases : null,
    topPurchase: top,
    negativeDays: summary.rows.filter(r => r.balance < 0).length,
  };
}

// The first `count` calendar days of a period, so a part-finished month is compared fairly.
export function firstDays(opening: number, days: Day[], period: string, count: number) {
  const last = addDays(periodRange(period).start, Math.max(count, 1) - 1);
  const rows = summarisePeriod(opening, days, period).rows.filter(r => r.date <= last);
  const sum = (key: 'purchases' | 'costs' | 'otherCosts') => rows.reduce((total, r) => total + r[key], 0);
  return { purchases: sum('purchases'), costs: sum('costs'), otherCosts: sum('otherCosts') };
}

export type Verdict = { tone: Insight['tone']; short: string; text: string };
export type TrendRow = ReturnType<typeof monthlyTrend>[number];
type Direction = 'up' | 'flat' | 'down' | null;

// Changes within 2% count as flat, so small noise is not reported as a trend.
const FLAT_BAND = 0.02;
const changeOf = (now: number, before: number) => (before ? (now - before) / Math.abs(before) : null);
const directionOf = (change: number | null): Direction => (change === null ? null : change > FLAT_BAND ? 'up' : change < -FLAT_BAND ? 'down' : 'flat');

function marketingVerdict(marketing: number | null, purchases: number | null): Verdict | null {
  const m = directionOf(marketing), b = directionOf(purchases);
  if (!m || !b) return null;
  if (m === 'up' && b === 'up') {
    return purchases! >= marketing!
      ? { tone: 'good', short: 'Berbaloi', text: 'Marketing naik dan belian naik lebih laju. Perbelanjaan ini nampak berbaloi.' }
      : { tone: 'warn', short: 'Kurang berkesan', text: 'Belian naik, tapi lebih perlahan daripada kos marketing. Semak iklan yang paling berkesan sebelum tambah lagi.' };
  }
  if (m === 'up') return { tone: 'warn', short: 'Tak berkesan', text: `Marketing naik tapi belian ${b === 'flat' ? 'statik' : 'turun'}. Semak iklan sebelum tambah bajet.` };
  if (m === 'down' && b === 'up') return { tone: 'good', short: 'Lebih cekap', text: 'Marketing turun tapi belian naik. Lebih cekap berbanding bulan sebelumnya.' };
  if (m === 'down' && b === 'flat') return { tone: 'good', short: 'Jimat', text: 'Marketing turun dan belian kekal. Kos dijimatkan tanpa menjejaskan belian.' };
  if (m === 'down') return { tone: 'warn', short: 'Belian ikut turun', text: 'Marketing dan belian sama-sama turun. Semak sama ada pengurangan marketing menjejaskan belian.' };
  if (b === 'up') return { tone: 'good', short: 'Lebih cekap', text: 'Marketing kekal dan belian naik.' };
  if (b === 'down') return { tone: 'warn', short: 'Belian turun', text: 'Marketing kekal tapi belian turun. Semak punca selain marketing.' };
  return { tone: 'info', short: 'Statik', text: 'Marketing dan belian kekal hampir sama.' };
}

function grossVerdict(purchases: number | null, gross: number | null): Verdict | null {
  const b = directionOf(purchases), g = directionOf(gross);
  if (!b || !g) return null;
  if (b === 'up' && g === 'up') {
    return gross! >= purchases!
      ? { tone: 'good', short: 'Sihat', text: 'Belian naik dan untung kasar naik sama laju atau lebih. Margin terjaga.' }
      : { tone: 'warn', short: 'Margin menipis', text: 'Untung kasar naik, tapi lebih perlahan daripada belian. Margin menipis, jadi sales perlu perhatikan harga belian.' };
  }
  if (b === 'up') return { tone: 'warn', short: 'Sales perlu nego', text: `Belian naik tapi untung kasar ${g === 'flat' ? 'statik' : 'turun'}. Sales perlu tingkatkan rundingan harga belian.` };
  if (b === 'flat' && g === 'up') return { tone: 'good', short: 'Margin baik', text: 'Belian kekal dan untung kasar naik. Harga belian lebih baik.' };
  if (b === 'flat' && g === 'down') return { tone: 'warn', short: 'Margin turun', text: 'Belian kekal tapi untung kasar turun. Semak harga belian dan harga jual kilang.' };
  if (b === 'flat') return { tone: 'info', short: 'Statik', text: 'Belian dan untung kasar kekal hampir sama.' };
  if (g === 'up') return { tone: 'good', short: 'Margin baik', text: 'Belian turun tapi untung kasar naik. Harga belian lebih baik.' };
  if (g === 'flat') return { tone: 'good', short: 'Margin baik', text: 'Belian turun tapi untung kasar kekal. Margin bertambah baik.' };
  return gross! < purchases!
    ? { tone: 'warn', short: 'Margin turun', text: 'Untung kasar turun lebih banyak daripada belian. Semak harga belian dan harga jual kilang.' }
    : { tone: 'info', short: 'Ikut belian', text: 'Untung kasar turun selari dengan belian. Fokus untuk naikkan belian.' };
}

// Months with a result from the factory, oldest first. A month still running is left out,
// because its purchases are incomplete and would make every comparison look wrong.
export function monthlyTrend(opening: number, days: Day[], months: MonthFigures[], today: string) {
  const rows = [...months]
    .sort((a, b) => a.period.localeCompare(b.period))
    .filter(m => !periodStats(opening, days, m.period, today).inProgress)
    .map(m => {
      const purchases = summarisePeriod(opening, days, m.period).purchases;
      const marketing = m.marketing_sen ?? 0, gross = m.gross_profit_sen, opex = opexOf(m);
      return { period: m.period, purchases, marketing, gross, opex, net: gross - marketing - opex };
    })
    .filter(r => r.purchases > 0);
  return rows.map((r, i) => {
    const previous = rows[i - 1];
    const purchasesChange = previous ? changeOf(r.purchases, previous.purchases) : null;
    const marketingChange = previous ? changeOf(r.marketing, previous.marketing) : null;
    const grossChange = previous ? changeOf(r.gross, previous.gross) : null;
    return {
      ...r,
      purchasesChange,
      marketingChange,
      grossChange,
      margin: r.gross / r.purchases,
      marketingRatio: r.marketing / r.purchases,
      purchasesPerMarketing: r.marketing ? r.purchases / r.marketing : null,
      marketingVerdict: marketingVerdict(marketingChange, purchasesChange),
      grossVerdict: grossVerdict(purchasesChange, grossChange),
    };
  });
}

export function overallPerformance(trend: TrendRow[]) {
  const sum = (key: 'purchases' | 'gross' | 'marketing' | 'opex' | 'net') => trend.reduce((total, r) => total + r[key], 0);
  const purchases = sum('purchases'), gross = sum('gross'), marketing = sum('marketing'), opex = sum('opex');
  const months = trend.length;
  const margin = purchases ? gross / purchases : null;
  const monthlyCost = months ? Math.round((marketing + opex) / months) : 0;
  return {
    months,
    first: trend[0]?.period ?? '',
    last: trend.at(-1)?.period ?? '',
    purchases, gross, marketing, opex,
    net: sum('net'),
    margin,
    marketingRatio: purchases ? marketing / purchases : null,
    monthlyCost,
    // Purchases a month needs for what is left after marketing to cover OPEX.
    breakEvenPurchases: purchases && gross > marketing ? Math.round((opex / months) / ((gross - marketing) / purchases)) : null,
  };
}

// Change as people read it: a loss growing from -100 to -130 is a 30% rise in the loss.
export function changeRatio(now: number, before: number) {
  if (!before) return null;
  if (now < 0 && before < 0) return (Math.abs(now) - Math.abs(before)) / Math.abs(before);
  return (now - before) / Math.abs(before);
}

// Net profit target from the three months before `period`, using whatever of them is complete.
// With a loss brought in, the target recovers it over `recoveryMonths`. Without one, it asks for
// 10% better than the recent average, or the same amount if that average was a loss.
export function netTarget({ trend, period, carried, recoveryMonths, stats, shiftPeriod }: {
  trend: TrendRow[];
  period: string;
  carried: number;
  recoveryMonths: number;
  stats: PeriodStats;
  shiftPeriod: (period: string, by: number) => string;
}) {
  const earliest = shiftPeriod(period, -3);
  const base = trend.filter(r => r.period >= earliest && r.period < period);
  if (!base.length) return null;
  const sum = (key: 'purchases' | 'gross' | 'marketing' | 'opex' | 'net') => base.reduce((total, r) => total + r[key], 0);
  const count = base.length;
  const avgPurchases = Math.round(sum('purchases') / count);
  const avgMarketing = Math.round(sum('marketing') / count);
  const avgOpex = Math.round(sum('opex') / count);
  const avgNet = Math.round(sum('net') / count);
  const avgCost = avgMarketing + avgOpex;
  const avgMargin = sum('purchases') ? sum('gross') / sum('purchases') : 0;
  const marketingRatio = sum('purchases') ? sum('marketing') / sum('purchases') : 0;
  // More purchases take more marketing at today's rate, so only what is left after marketing pays OPEX.
  const marginAfterMarketing = avgMargin - marketingRatio;
  const target = carried > 0 ? Math.round(carried / recoveryMonths) : Math.round(Math.abs(avgNet) * 1.1);
  const neededGross = target + avgCost;
  const neededAfterMarketing = target + avgOpex;
  const neededPurchases = marginAfterMarketing > 0 ? Math.round(neededAfterMarketing / marginAfterMarketing) : null;
  const breakEvenPurchases = marginAfterMarketing > 0 ? Math.round(avgOpex / marginAfterMarketing) : null;
  const neededMargin = avgPurchases ? neededGross / avgPurchases : null;
  // Marketing allowed at recent purchases and margin. Below zero means cutting it cannot reach the target.
  const marketingLimit = Math.round(avgPurchases * avgMargin) - neededAfterMarketing;
  const remainingDays = stats.inProgress ? stats.fullLength - stats.elapsed : 0;
  const projectedPurchases = stats.inProgress ? Math.round((stats.purchases / stats.elapsed) * stats.fullLength) : stats.purchases;
  const projectedNet = Math.round(projectedPurchases * marginAfterMarketing) - avgOpex;
  const neededPerDay = neededPurchases !== null && remainingDays > 0 ? Math.max(0, Math.round((neededPurchases - stats.purchases) / remainingDays)) : null;
  // Beyond three times recent purchases, volume alone is not a realistic answer.
  const volumeUnrealistic = neededPurchases === null || neededPurchases > avgPurchases * 3;
  return {
    baseFrom: base[0].period,
    baseTo: base.at(-1)!.period,
    count,
    avgPurchases, avgMarketing, avgOpex, avgCost, avgNet, avgMargin, marketingRatio, marginAfterMarketing,
    marketingLimit, volumeUnrealistic,
    target, neededGross, neededPurchases, breakEvenPurchases, neededMargin,
    // Too few recorded days and a single large purchase would decide the projection.
    projectionReliable: !stats.inProgress || stats.recorded >= 7,
    purchasesSoFar: stats.purchases,
    recordedDays: stats.recorded,
    projectedPurchases, projectedNet, neededPerDay, inProgress: stats.inProgress,
  };
}

export const quarterPeriods = (year: number, quarter: number) =>
  [1, 2, 3].map(i => `${year}-${String((quarter - 1) * 3 + i).padStart(2, '0')}`);
export const yearPeriods = (year: number) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

// Totals across several accounting months. Months not started yet are ignored, and profit
// figures only count months already entered, so an unfinished range is never reported as zero.
export function rangeSummary(opening: number, days: Day[], months: MonthFigures[], periods: string[], openingProfit: OpeningProfit | undefined, today: string) {
  const active = periods.filter(p => p <= periodOf(today));
  const parts = active.map(p => summarisePeriod(opening, days, p));
  const sum = (key: 'purchases' | 'costs' | 'otherCosts' | 'capitalIn' | 'returned' | 'passed') => parts.reduce((total, r) => total + r[key], 0);
  const filled = active.filter(p => months.some(m => m.period === p));
  const profits = filled.map(p => profitFor(months, p, openingProfit));
  const add = (key: 'gross' | 'marketing' | 'opex' | 'own') => profits.reduce((total, r) => total + r[key], 0);
  const filledPurchases = filled.reduce((total, p) => total + summarisePeriod(opening, days, p).purchases, 0);
  const gross = add('gross'), marketing = add('marketing');
  return {
    started: active.length > 0,
    months: active.length,
    filledMonths: filled.length,
    purchases: sum('purchases'), costs: sum('costs'), otherCosts: sum('otherCosts'),
    capitalIn: sum('capitalIn'), returned: sum('returned'), passed: sum('passed'),
    gross, marketing, opex: add('opex'), own: add('own'),
    margin: filledPurchases ? gross / filledPurchases : null,
    marketingRatio: filledPurchases ? marketing / filledPurchases : null,
    final: active.length ? profitFor(months, active.at(-1)!, openingProfit).final : 0,
    startBalance: parts[0]?.startBalance ?? 0,
    balance: parts.at(-1)?.balance ?? 0,
  };
}
