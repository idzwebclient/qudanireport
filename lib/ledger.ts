export type TxnKind = 'capital_in' | 'purchase' | 'cost' | 'other_cost' | 'capital_return' | 'capital_pass';

export type Txn = {
  id: string;
  branch_id: string;
  txn_date: string;
  kind: TxnKind;
  amount_sen: number;
  description: string;
  counterparty: string;
  voided_at: string | null;
};

export type Day = {
  date: string;
  start: number;
  capitalIn: number;
  purchases: number;
  costs: number;
  otherCosts: number;
  returned: number;
  passed: number;
  balance: number;
  txns: Txn[];
};

export const KIND_LABEL: Record<TxnKind, string> = {
  capital_in: 'Modal masuk',
  purchase: 'Belian',
  cost: 'Kos',
  other_cost: 'Lain-lain kos',
  capital_return: 'Pulang modal',
  capital_pass: 'Pass modal',
};

export const money = (sen: number) =>
  (sen < 0 ? '-RM' : 'RM') + (Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Parsed from the text rather than via floats, so 19.99 is exactly 1999 sen.
export function parseSen(input: string): number | null {
  const text = input.trim().replace(',', '.');
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1] ?? 0);
  const fraction = (match[2] ?? match[3] ?? '').padEnd(2, '0');
  return whole * 100 + Number(fraction);
}

export const senToInput = (sen: number) => (sen ? (sen / 100).toFixed(2) : '');

export const todayKL = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

// Accounting month runs from the 25th to the 24th. Mirrors public.accounting_period in SQL.
export function periodOf(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + (day >= 25 ? 1 : 0), 1));
  return iso(d).slice(0, 7);
}

export function shiftPeriod(period: string, by: number) {
  const [year, month] = period.split('-').map(Number);
  return iso(new Date(Date.UTC(year, month - 1 + by, 1))).slice(0, 7);
}

export function periodRange(period: string) {
  const [year, month] = period.split('-').map(Number);
  return { start: iso(new Date(Date.UTC(year, month - 2, 25))), end: iso(new Date(Date.UTC(year, month - 1, 24))) };
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat('ms-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));

export function periodLabel(period: string) {
  const { start, end } = periodRange(period);
  return `${shortDate(start)} – ${shortDate(end)} ${end.slice(0, 4)}`;
}

export const periodShortLabel = (period: string) =>
  new Intl.DateTimeFormat('ms-MY', { month: 'short', timeZone: 'UTC' }).format(new Date(period + '-01T00:00:00Z'));

export const dateLabel = (date: string) => date.split('-').reverse().join('/');

export const longDateLabel = (date: string) =>
  new Intl.DateTimeFormat('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));

export function buildDays(opening: number, txns: Txn[], openingDate?: string | null): Day[] {
  const byDate = new Map<string, Txn[]>();
  for (const txn of txns) {
    if (txn.voided_at || (openingDate && txn.txn_date < openingDate)) continue;
    byDate.set(txn.txn_date, [...(byDate.get(txn.txn_date) ?? []), txn]);
  }
  let balance = opening;
  return [...byDate.keys()].sort().map(date => {
    const dayTxns = byDate.get(date)!;
    const sum = (kind: TxnKind) => dayTxns.filter(t => t.kind === kind).reduce((total, t) => total + t.amount_sen, 0);
    const start = balance;
    const capitalIn = sum('capital_in'), purchases = sum('purchase'), costs = sum('cost'), otherCosts = sum('other_cost'), returned = sum('capital_return'), passed = sum('capital_pass');
    balance = start + capitalIn - purchases - costs - otherCosts - returned - passed;
    return { date, start, capitalIn, purchases, costs, otherCosts, returned, passed, balance, txns: dayTxns };
  });
}

// Days without records still have a valid view: the balance carried forward from before them.
export function dayView(opening: number, days: Day[], date: string): Day {
  const existing = days.find(d => d.date === date);
  if (existing) return existing;
  const balance = days.filter(d => d.date < date).at(-1)?.balance ?? opening;
  return { date, start: balance, capitalIn: 0, purchases: 0, costs: 0, otherCosts: 0, returned: 0, passed: 0, balance, txns: [] };
}

export function summarisePeriod(opening: number, days: Day[], period: string) {
  const { start, end } = periodRange(period);
  const rows = days.filter(d => d.date >= start && d.date <= end);
  const startBalance = days.filter(d => d.date < start).at(-1)?.balance ?? opening;
  const sum = (key: 'capitalIn' | 'purchases' | 'costs' | 'otherCosts' | 'returned' | 'passed') => rows.reduce((total, r) => total + r[key], 0);
  const totals = { capitalIn: sum('capitalIn'), purchases: sum('purchases'), costs: sum('costs'), otherCosts: sum('otherCosts'), returned: sum('returned'), passed: sum('passed') };
  return { rows, startBalance, ...totals, balance: rows.at(-1)?.balance ?? startBalance };
}

// Every day of a period up to today, so charts show a full timeline rather than only days with records.
export function fillPeriod(opening: number, days: Day[], period: string, today: string): Day[] {
  const { start, end } = periodRange(period);
  const last = end < today ? end : today;
  const filled: Day[] = [];
  for (let date = start; date <= last; date = addDays(date, 1)) filled.push(dayView(opening, days, date));
  return filled;
}

function transferLines(day: Day) {
  return day.txns
    .filter(t => t.kind === 'capital_return' || t.kind === 'capital_pass')
    .map(t => `${t.kind === 'capital_pass' ? 'Pass' : 'Pulang'} modal: ${money(t.amount_sen)}${t.counterparty ? ` (${t.counterparty})` : ''}`);
}

export function report(branch: string, day: Day, mode: 'compact' | 'detailed' = 'compact') {
  if (mode === 'compact') {
    const lines = [`*REPORT HARIAN — ${branch.toLocaleUpperCase('ms-MY')}*`, dateLabel(day.date), '', `Modal awal: ${money(day.start)}`];
    if (day.capitalIn) lines.push(`Modal masuk: ${money(day.capitalIn)}`);
    lines.push(`Belian: ${money(day.purchases)}`);
    if (day.costs) lines.push(`Kos: ${money(day.costs)}`);
    if (day.otherCosts) lines.push(`Lain-lain kos: ${money(day.otherCosts)}`);
    lines.push(...transferLines(day), '', `*BAKI: ${money(day.balance)}*`);
    return lines.join('\n');
  }
  const details = (kind: TxnKind) => day.txns.filter(t => t.kind === kind && t.description).map(t => `  • ${t.description}: ${money(t.amount_sen)}`);
  return [
    '*DAILY REPORT*', dateLabel(day.date), `Cawangan: ${branch}`, '', '──────────────',
    `Modal Awal: ${money(day.start)}`, `Modal Hari Ini: ${money(day.capitalIn)}`, `*Total Modal: ${money(day.start + day.capitalIn)}*`, '', '──────────────',
    `*Total Belian: ${money(day.purchases)}*`, ...details('purchase'), `*Total Kos: ${money(day.costs)}*`, ...details('cost'), `*Total Kos + Belian: ${money(day.costs + day.purchases)}*`, ...(day.otherCosts ? [`*Lain-lain Kos: ${money(day.otherCosts)}*`, ...details('other_cost')] : []), '', '──────────────',
    ...(transferLines(day).length ? transferLines(day) : ['Pulang / pass modal: RM0.00']), '', '──────────────', '*BAKI MODAL*', `*${money(day.balance)}*`,
  ].join('\n');
}

export function periodCsv(branch: string, rows: Day[]) {
  const header = ['Tarikh', 'Cawangan', 'Modal awal', 'Modal masuk', 'Belian', 'Kos', 'Lain-lain kos', 'Pulang modal', 'Pass modal', 'Baki'];
  // Prefix text that a spreadsheet would run as a formula; numbers stay numeric.
  const text = (value: string) => `"${value.replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  const amount = (sen: number) => (sen / 100).toFixed(2);
  const lines = rows.map(r => [r.date, text(branch), amount(r.start), amount(r.capitalIn), amount(r.purchases), amount(r.costs), amount(r.otherCosts), amount(r.returned), amount(r.passed), amount(r.balance)].join(','));
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}

export function rangeReport(branch: string, opening: number, days: Day[], from: string, to: string) {
  const rows = days.filter(d => d.date >= from && d.date <= to);
  const start = days.filter(d => d.date < from).at(-1)?.balance ?? opening;
  const sum = (key: 'capitalIn' | 'purchases' | 'costs' | 'otherCosts') => rows.reduce((total, r) => total + r[key], 0);
  const capitalIn = sum('capitalIn'), purchases = sum('purchases'), costs = sum('costs'), otherCosts = sum('otherCosts');
  const transfers = new Map<string, number>();
  for (const t of rows.flatMap(r => r.txns)) {
    if (t.kind !== 'capital_return' && t.kind !== 'capital_pass') continue;
    const label = `${t.kind === 'capital_pass' ? 'Pass' : 'Pulang'} modal${t.counterparty ? ` (${t.counterparty})` : ''}`;
    transfers.set(label, (transfers.get(label) ?? 0) + t.amount_sen);
  }
  return [
    '*REPORT MODAL*', `${dateLabel(from)} hingga ${dateLabel(to)}`, `Cawangan: ${branch}`, '', '──────────────',
    `Modal Awal: ${money(start)}`, `Modal Masuk: ${money(capitalIn)}`, `*Total Modal: ${money(start + capitalIn)}*`, '', '──────────────',
    `*Total Belian: ${money(purchases)}*`, `*Total Kos: ${money(costs)}*`, ...(otherCosts ? [`*Lain-lain Kos: ${money(otherCosts)}*`] : []), `*Total Kos + Belian: ${money(costs + purchases + otherCosts)}*`, '', '──────────────',
    ...(transfers.size ? [...transfers].map(([label, sen]) => `${label}: ${money(sen)}`) : ['Pulang / pass modal: RM0.00']), '', '──────────────',
    '*BAKI MODAL*', `*${money(rows.at(-1)?.balance ?? start)}*`,
  ].join('\n');
}
