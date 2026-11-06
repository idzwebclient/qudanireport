import assert from 'node:assert/strict';
import { addDays, buildDays, dayView, fillPeriod, money, parseSen, periodCsv, periodLabel, periodOf, periodRange, pairPurchases, rangeReport, report, shiftPeriod, summarisePeriod, summariseRange, todayKL, type Txn, type TxnKind } from '../lib/ledger.ts';

import { createFlusher, type OutboxItem } from '../lib/outbox.ts';
import { changeRatio, firstDays, monthlyTrend, netTarget, overallPerformance, periodStats, profitFor, quarterPeriods, rangeSummary, yearPeriods } from '../lib/insights.ts';

const txn = (txn_date: string, kind: TxnKind, amount_sen: number, extra: Partial<Txn> = {}): Txn => ({
  id: crypto.randomUUID(), branch_id: 'b', txn_date, kind, amount_sen, description: '', counterparty: '', voided_at: null, ...extra,
});

// Amount parsing must be exact and reject junk
assert.equal(parseSen('19.99'), 1999);
assert.equal(parseSen('1,5'), 150);
assert.equal(parseSen('.5'), 50);
assert.equal(parseSen('1000'), 100000);
assert.equal(parseSen('1.'), 100);
for (const bad of ['', 'abc', '1.234', '-5', '1e5', '1.2.3']) assert.equal(parseSen(bad), null, bad);

// Accounting period 25th to 24th
assert.equal(periodOf('2026-10-24'), '2026-10');
assert.equal(periodOf('2026-10-25'), '2026-11');
assert.equal(periodOf('2026-10-31'), '2026-11', 'hari ini mesti berada dalam tempoh yang betul');
assert.equal(periodOf('2026-12-25'), '2027-01');
assert.deepEqual(periodRange('2026-10'), { start: '2026-09-25', end: '2026-10-24' });
assert.deepEqual(periodRange('2026-01'), { start: '2025-12-25', end: '2026-01-24' });
assert.equal(shiftPeriod('2026-01', -1), '2025-12');
assert.equal(shiftPeriod('2026-12', 1), '2027-01');
assert.ok(periodLabel('2026-10').endsWith('2026'));
assert.equal(addDays('2026-02-28', 1), '2026-03-01');
assert.equal(todayKL(new Date('2026-10-31T17:00:00Z')), '2026-11-01', 'tarikh ikut waktu Malaysia');

// Balances carry forward, several records per day, voided records ignored
const txns = [
  txn('2026-10-02', 'capital_in', 10000),
  txn('2026-10-02', 'purchase', 2000, { description: 'Emas 916' }),
  txn('2026-10-02', 'purchase', 1000),
  txn('2026-10-02', 'capital_pass', 500, { counterparty: 'HQ' }),
  txn('2026-10-01', 'cost', 300),
  txn('2026-10-01', 'cost', 9999, { voided_at: '2026-10-01T00:00:00Z' }),
  txn('2026-10-25', 'capital_return', 700),
];
const days = buildDays(20000, txns);
assert.deepEqual(days.map(d => d.date), ['2026-10-01', '2026-10-02', '2026-10-25']);
assert.deepEqual(days.map(d => d.balance), [19700, 26200, 25500]);
assert.equal(days[1].start, 19700);
assert.equal(dayView(20000, days, '2026-10-10').balance, 26200, 'hari kosong membawa baki terdahulu');
assert.equal(dayView(20000, days, '2026-09-01').balance, 20000, 'sebelum rekod pertama guna modal permulaan');

// Period totals exclude the next period's 25th
const october = summarisePeriod(20000, days, '2026-10');
assert.equal(october.startBalance, 20000);
assert.equal(october.purchases, 3000);
assert.equal(october.returned, 0);
assert.equal(october.balance, 26200);
const november = summarisePeriod(20000, days, '2026-11');
assert.equal(november.startBalance, 26200);
assert.equal(november.returned, 700);
assert.equal(summarisePeriod(20000, days, '2027-05').balance, 25500, 'tempoh kosong membawa baki');

// Timelines cover every day up to today and carry the balance across empty days
const timeline = fillPeriod(20000, days, '2026-10', '2026-10-03');
assert.deepEqual(timeline.at(-1)?.date, '2026-10-03');
assert.equal(timeline.length, 9, '25 Sep hingga 3 Okt');
assert.equal(timeline[0].balance, 20000);
assert.equal(timeline.at(-1)?.balance, 26200);
assert.equal(fillPeriod(20000, days, '2026-10', '2026-12-01').length, 30, 'tempoh lepas berhenti pada 24 hb');
assert.equal(fillPeriod(20000, days, '2027-05', '2026-10-03').length, 0, 'tempoh akan datang kosong');

// Other costs reduce the balance and appear with their detail
const withOther = buildDays(1000, [txn('2026-10-01', 'other_cost', 300, { description: 'Baiki kaunter' })]);
assert.equal(withOther[0].otherCosts, 300);
assert.equal(withOther[0].balance, 700);
assert.equal(summarisePeriod(1000, withOther, '2026-10').otherCosts, 300);
assert.ok(report('A', withOther[0]).includes('Lain-lain kos: RM3.00'));
assert.ok(report('A', withOther[0], 'detailed').includes('• Baiki kaunter: RM3.00'));

// Reports
const compact = report('Alor Setar', days[1]);
assert.ok(compact.includes('*REPORT HARIAN — ALOR SETAR*'));
assert.ok(compact.includes('Pass modal: RM5.00 (HQ)'));
assert.ok(compact.includes('*BAKI: RM262.00*'));
const detailed = report('Alor Setar', days[1], 'detailed');
assert.ok(detailed.includes('• Emas 916: RM20.00'));
assert.ok(detailed.includes('*Total Modal: RM297.00*'));
assert.equal(money(-150), '-RM1.50');

// CSV neutralises formulas in text
const csv = periodCsv('=HACK"', [days[0]]);
assert.ok(csv.includes(`"'=HACK"""`));
assert.ok(csv.includes('-') && csv.includes('197.00'));

// Fair comparison for a part-finished month: the same number of days from the earlier month
const history = buildDays(100000, [
  ...Array.from({ length: 10 }, (_, i) => txn(`2026-10-${String(i + 1).padStart(2, '0')}`, 'purchase', 1000)),
  txn('2026-09-25', 'purchase', 4000),
  txn('2026-09-26', 'purchase', 6000),
  txn('2026-09-26', 'cost', 300),
  txn('2026-10-25', 'purchase', 2000),
  txn('2026-10-25', 'cost', 500),
  txn('2026-10-26', 'capital_in', 50),
]);
const oct = periodStats(100000, history, '2026-10', '2026-10-27'), nov = periodStats(100000, history, '2026-11', '2026-10-27');
assert.equal(oct.inProgress, false);
assert.equal(nov.inProgress, true);
assert.equal(nov.elapsed, 3, '25 hingga 27 Okt');
assert.equal(nov.topPurchase?.date, '2026-10-25');
assert.equal(nov.costRatio, 0.25);
assert.deepEqual(firstDays(100000, history, '2026-10', 3), { purchases: 10000, costs: 300, otherCosts: 0 }, 'hanya 3 hari pertama');

const figures = (period: string, gross: number, opex: number) => ({ period, gross_profit_sen: gross, opex: [{ amount_sen: opex }] });

// Margin uses only months that have a result, as a share of their purchases

// A month not yet sold is expected, not an error, and gets an estimate

// Losses chain from month to month, and gross may itself be a loss
const lossy = [figures('2026-09', 1000, 4230), figures('2026-10', 1000, 500), figures('2026-12', 9000, 1000)];
assert.equal(profitFor(lossy, '2026-09').carried, 0);
assert.deepEqual(profitFor(lossy, '2026-10'), { filled: true, gross: 1000, opex: 500, marketing: 0, own: 500, carried: 3230, final: -2730 });
assert.equal(profitFor(lossy, '2026-11').carried, 2730, 'bulan tanpa data tetap membawa rugi');
assert.equal(profitFor(lossy, '2026-12').final, 5270);
assert.equal(profitFor(lossy, '2027-01').carried, 0, 'untung tidak dibawa, rugi dah habis ditampung');
assert.equal(profitFor([figures('2026-10', -700, 300)], '2026-10').own, -1000, 'rugi kasar');

// Marketing is its own figure, deducted beside OPEX. These are the real October figures.
const october2 = { period: '2026-10', gross_profit_sen: 873321, marketing_sen: 805000, opex: [200000, 9892, 280000, 57300, 281150, 24625, 111330].map(amount_sen => ({ amount_sen })) };
const octProfit = profitFor([october2], '2026-10');
assert.equal(octProfit.marketing, 805000);
assert.equal(octProfit.opex, 964297);
assert.equal(octProfit.own, -895976);

// Opening figures restart the chain from their date
const fromOpening = { opening_pl_sen: -5000, opening_pl_date: '2026-09-30' };
assert.equal(profitFor(lossy, '2026-09', fromOpening).carried, 0, 'tempoh sebelum tarikh tidak terkesan');
assert.equal(profitFor(lossy, '2026-10', fromOpening).carried, 5000, 'nilai permulaan menggantikan rugi bulan terdahulu');
assert.equal(profitFor(lossy, '2026-10', fromOpening).final, -4500);
assert.equal(profitFor(lossy, '2026-11', fromOpening).carried, 4500);
const profitStart = profitFor(lossy, '2026-10', { opening_pl_sen: 2000, opening_pl_date: '2026-09-24' });
assert.equal(profitStart.carried, -2000);
assert.equal(profitStart.final, 2500, 'untung permulaan dicampur');
assert.equal(profitFor(lossy, '2026-11', { opening_pl_sen: 2000, opening_pl_date: '2026-09-24' }).carried, 0);
assert.equal(profitFor(lossy, '2026-10', { opening_pl_sen: 0, opening_pl_date: null }).carried, 3230);
// The real figures: 23,452.49 before 25 Aug, then -8,848.21 and -8,959.76
const real = { opening_pl_sen: -2345249, opening_pl_date: '2026-08-24' };
const realMonths = [figures('2026-09', 0, 884821), figures('2026-10', 0, 895976)];
assert.equal(profitFor(realMonths, '2026-10', real).final, -4126046);
assert.equal(profitFor(realMonths, '2026-10', real).own, -895976, 'bulan itu sahaja');

const dated = buildDays(1000, [txn('2026-09-01', 'capital_in', 500), txn('2026-10-01', 'capital_in', 200)], '2026-09-15');
assert.deepEqual(dated.map(d => d.balance), [1200], 'rekod sebelum tarikh modal tidak dikira');

// Decisions: each row reads marketing against purchases, and purchases against gross profit
const buys = buildDays(0, [
  txn('2026-06-10', 'purchase', 10000), txn('2026-07-10', 'purchase', 13000), txn('2026-08-10', 'purchase', 12800),
  txn('2026-09-10', 'purchase', 15000), txn('2026-10-10', 'purchase', 18000), txn('2026-10-28', 'purchase', 2000),
]);
const mk = (period: string, gross: number, marketing: number) => ({ period, gross_profit_sen: gross, marketing_sen: marketing, opex: [{ amount_sen: 1000 }] });
const series = monthlyTrend(0, buys, [mk('2026-08', 1250, 700), mk('2026-06', 900, 500), mk('2026-07', 1300, 550), mk('2026-09', 1240, 700), mk('2026-10', 1150, 805), mk('2026-11', 500, 100)], '2026-10-31');
assert.deepEqual(series.map(r => r.period), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'], 'bulan masih berjalan dikecualikan');
assert.equal(series[0].marketingVerdict, null, 'bulan pertama tiada perbandingan');
assert.equal(series[1].marketingVerdict?.short, 'Berbaloi');
assert.equal(series[1].grossVerdict?.short, 'Sihat');
assert.equal(series[2].marketingVerdict?.short, 'Tak berkesan', 'marketing naik, belian statik');
assert.equal(series[3].marketingVerdict?.short, 'Lebih cekap');
assert.equal(series[3].grossVerdict?.short, 'Sales perlu nego', 'belian naik, untung statik');
assert.ok(series[3].grossVerdict?.text.includes('statik'));
assert.equal(series[4].grossVerdict?.short, 'Sales perlu nego', 'belian naik, untung turun');
assert.ok(series[4].grossVerdict?.text.includes('turun'));
assert.equal(series[4].marketingRatio, 805 / 18000);
const whole = overallPerformance(series);
assert.equal(whole.months, 5);
assert.equal(whole.purchases, 68800);
assert.equal(whole.gross, 5840);
assert.equal(whole.net, 5840 - 3255 - 5000);
assert.equal(whole.monthlyCost, Math.round((3255 + 5000) / 5));
assert.equal(whole.breakEvenPurchases, Math.round(1000 / ((5840 - 3255) / 68800)));
assert.equal(overallPerformance([]).breakEvenPurchases, null);

// A growing loss is a rise, as the real Sep to Oct figures show
assert.ok(Math.abs(changeRatio(-4126046, -3230070)! - 0.2774) < 0.001, 'rugi bertambah: peratus naik');
assert.ok(changeRatio(-100, -130)! < 0, 'rugi berkurang: peratus turun');
assert.equal(changeRatio(150, 100), 0.5);
assert.equal(changeRatio(-50, 100), -1.5);
assert.equal(changeRatio(5, 0), null);

// Target from real September and October figures, with the real accumulated loss
const realBuys = buildDays(0, [txn('2026-09-10', 'purchase', 19118906), txn('2026-10-10', 'purchase', 11277679), txn('2026-10-30', 'purchase', 2000000)]);
const realFigures = [
  { period: '2026-09', gross_profit_sen: 1165402, marketing_sen: 1065000, opex: [{ amount_sen: 985223 }] },
  { period: '2026-10', gross_profit_sen: 873321, marketing_sen: 805000, opex: [{ amount_sen: 964297 }] },
];
const realTrend = monthlyTrend(0, realBuys, realFigures, '2026-10-31');
const running = periodStats(0, realBuys, '2026-11', '2026-10-31');
const goal = netTarget({ trend: realTrend, period: '2026-11', carried: 4126046, recoveryMonths: 6, stats: running, shiftPeriod })!;
assert.equal(goal.count, 2, 'guna data yang ada');
assert.equal(goal.target, 687674);
assert.equal(goal.avgCost, 935000 + 974760);
assert.equal(goal.neededGross, 687674 + 1909760);
assert.ok(Math.abs(goal.avgMargin - 2038723 / 30396585) < 1e-9);
const afterMarketing = (2038723 - 1870000) / 30396585;
assert.ok(Math.abs(goal.marginAfterMarketing - afterMarketing) < 1e-12);
assert.equal(goal.neededPurchases, Math.round((687674 + 974760) / afterMarketing));
assert.equal(goal.breakEvenPurchases, Math.round(974760 / afterMarketing));
assert.ok(goal.breakEvenPurchases! > 170000000, 'pulang kos sekitar RM1.76 juta bila marketing ikut naik');
assert.equal(goal.volumeUnrealistic, true);
assert.ok(goal.marketingLimit < 0, 'potong marketing sahaja tak cukup');
assert.ok(Math.abs(goal.neededMargin! - 2597434 / 15198293) < 0.001);
assert.equal(running.fullLength, 31, '25 Okt hingga 24 Nov');
assert.equal(goal.projectedPurchases, Math.round((2000000 / 7) * 31));
assert.equal(goal.projectedNet, Math.round(goal.projectedPurchases * afterMarketing) - 974760);
assert.equal(goal.neededPerDay, Math.round((goal.neededPurchases! - 2000000) / 24));
assert.equal(goal.projectionReliable, false, 'terlalu sedikit hari rekod untuk unjuran');
assert.equal(netTarget({ trend: [], period: '2026-11', carried: 0, recoveryMonths: 6, stats: running, shiftPeriod }), null);
const noLoss = netTarget({ trend: realTrend, period: '2026-11', carried: 0, recoveryMonths: 6, stats: running, shiftPeriod })!;
assert.equal(noLoss.target, Math.round(noLoss.avgNet * -1 * 1.1));
const oldOnly = netTarget({ trend: monthlyTrend(0, realBuys, realFigures, '2026-10-31'), period: '2027-03', carried: 0, recoveryMonths: 6, stats: running, shiftPeriod });
assert.equal(oldOnly, null, 'hanya 3 bulan sebelum');

// Ranges: quarters follow accounting months, unfilled and future months stay out of the totals
assert.deepEqual(quarterPeriods(2026, 4), ['2026-10', '2026-11', '2026-12']);
assert.equal(yearPeriods(2026).length, 12);
assert.equal(periodRange(quarterPeriods(2026, 1)[0]).start, '2025-12-25', 'Q1 bermula 25 Dis');
const q3 = rangeSummary(0, realBuys, realFigures, quarterPeriods(2026, 3), undefined, '2026-10-31');
assert.equal(q3.months, 3);
assert.equal(q3.purchases, 19118906);
assert.equal(q3.filledMonths, 1);
assert.equal(q3.gross, 1165402);
assert.equal(q3.own, 1165402 - 1065000 - 985223);
const q4 = rangeSummary(0, realBuys, realFigures, quarterPeriods(2026, 4), undefined, '2026-10-31');
assert.equal(q4.months, 2, 'Dis belum bermula');
assert.equal(q4.filledMonths, 1);
assert.equal(q4.purchases, 11277679 + 2000000);
assert.equal(q4.margin, 873321 / 11277679, 'margin hanya bulan yang diisi');
const whole2026 = rangeSummary(0, realBuys, realFigures, yearPeriods(2026), { opening_pl_sen: -2345249, opening_pl_date: '2026-08-24' }, '2026-10-31');
assert.equal(whole2026.gross, 1165402 + 873321);
assert.equal(whole2026.final, profitFor(realFigures, '2026-11', { opening_pl_sen: -2345249, opening_pl_date: '2026-08-24' }).final);
assert.equal(rangeSummary(0, realBuys, realFigures, quarterPeriods(2030, 1), undefined, '2026-10-31').started, false);

// Reports for any date range: real figures for 30 and 31 Oct
const realDays = buildDays(849000, [
  txn('2026-10-30', 'capital_in', 10370000), txn('2026-10-30', 'purchase', 9449600), txn('2026-10-30', 'cost', 2300),
  txn('2026-10-30', 'capital_return', 1000000, { counterparty: 'HQ' }), txn('2026-10-30', 'capital_return', 567100, { counterparty: 'HQ' }),
  txn('2026-10-31', 'purchase', 157420),
]);
const both = rangeReport('Alor Setar', 849000, realDays, '2026-10-25', '2026-10-31');
assert.ok(both.includes('25/10/2026 hingga 31/10/2026'));
assert.ok(both.includes('Modal Awal: RM8,490.00'));
assert.ok(both.includes('*Total Belian: RM96,070.20*'));
assert.ok(both.includes('Pulang modal (HQ): RM15,671.00'), 'pemindahan dijumlah ikut penerima');
assert.ok(both.includes('*RM425.80*'));
const lastDay = rangeReport('Alor Setar', 849000, realDays, '2026-10-31', '2026-10-31');
assert.ok(lastDay.includes('Modal Awal: RM2,000.00'), 'modal awal ialah baki sebelum tarikh Dari');
assert.ok(!lastDay.includes('Hari ada rekod'));
const none = rangeReport('Alor Setar', 849000, realDays, '2026-11-01', '2026-11-05');
assert.ok(none.includes('*RM425.80*'), 'tiada rekod membawa baki');


// Sejarah: any date range, carrying the balance from before it
{
  const days = buildDays(10000, [txn('2026-10-01', 'purchase', 1000), txn('2026-10-05', 'capital_in', 500), txn('2026-10-09', 'cost', 200)]);
  const r = summariseRange(10000, days, '2026-10-02', '2026-10-09');
  assert.equal(r.rows.length, 2);
  assert.equal(r.startBalance, 9000, 'baki awal ialah baki sebelum tarikh Dari');
  assert.equal(r.capitalIn, 500);
  assert.equal(r.costs, 200);
  assert.equal(r.balance, 9300);
  assert.deepEqual(summariseRange(10000, days, '2026-11-01', '2026-11-05').balance, 9300, 'julat tanpa rekod membawa baki');
}

// Belian and kos pair by pair_id, and older records by their note
{
  const linkedP = txn('2026-10-01', 'purchase', 1000, { pair_id: 'p1', description: 'Emas' });
  const legacyP = txn('2026-10-01', 'purchase', 2000, { description: 'Emas' });
  const legacyC = txn('2026-10-01', 'cost', 20, { description: 'Emas' });
  const linkedC = txn('2026-10-01', 'cost', 10, { pair_id: 'p1', description: 'Emas' });
  const loneC = txn('2026-10-01', 'cost', 5, { description: 'Lain' });
  const pairs = pairPurchases([linkedP, legacyP, legacyC, linkedC, loneC]);
  assert.equal(pairs.find(p => p.purchase === linkedP)?.cost, linkedC, 'pair_id menang walaupun catatan sama');
  assert.equal(pairs.find(p => p.purchase === legacyP)?.cost, legacyC, 'rekod lama dipadan ikut catatan');
  assert.ok(pairs.some(p => !p.purchase && p.cost === loneC), 'kos tanpa pasangan berdiri sendiri');
  assert.equal(pairs.length, 3);
}

// Offline queue: one flush at a time, and a newer edit queued mid-send is never dropped
{
  let box: OutboxItem[] = [];
  const sent: number[] = [];
  let release!: () => void;
  const flush = createFlusher({
    read: () => box,
    write: next => { box = next; },
    save: async t => {
      if (t.amount_sen === 100) await new Promise<void>(r => { release = r; });
      sent.push(t.amount_sen);
    },
    isNetworkError: () => false,
  });
  const v1 = txn('2026-10-01', 'purchase', 100);
  box = [{ txn: v1 }];
  const first = flush();
  await new Promise(r => setTimeout(r, 0));
  box = [{ txn: { ...v1, amount_sen: 200 } }];
  const second = flush();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [100, 200], 'versi baru dihantar selepas versi lama');
  assert.equal(box.length, 0);
}

console.log('✓ Kiraan baki, tempoh, report dan CSV lulus.');
