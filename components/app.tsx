'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, CheckCircle2, CloudOff, History, Landmark, LayoutDashboard, Loader2, PencilLine, Plus, Settings, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { money, periodOf, periodShortLabel, summarisePeriod, todayKL } from '../lib/ledger';
import { profitFor } from '../lib/insights';
import { createClient } from '../lib/supabase/client';
import { supabaseRepo, type Repo } from '../lib/repo';
import { useLedger, type SyncState } from '../lib/use-ledger';
import { Onboarding } from './onboarding';
import { TodayView } from './today';
import { RecordsView } from './records';
import { MonthView } from './month';
import { SettingsView } from './settings';

const DashboardView = dynamic(() => import('./dashboard').then(m => m.DashboardView), {
  ssr: false,
  loading: () => <p className="empty">Memuatkan Dashboard…</p>,
});

export type Tab = 'dashboard' | 'harian' | 'sejarah' | 'bulanan' | 'tetapan';
const TABS: [Tab, string, LucideIcon][] = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['harian', 'Harian', PencilLine],
  ['sejarah', 'Sejarah', History],
  ['bulanan', 'Bulanan', Landmark],
  ['tetapan', 'Tetapan', Settings],
];

const SIDE_GROUPS: [string, Tab[]][] = [
  ['Utama', ['dashboard', 'harian']],
  ['Laporan', ['sejarah', 'bulanan']],
];

const SYNC_LABEL: Record<SyncState, string> = {
  synced: 'Tersimpan',
  syncing: 'Menyegerak…',
  offline: 'Offline',
  pending: 'Belum dihantar',
  failed: 'Ada rekod gagal',
};

function SyncBadge({ state, count }: { state: SyncState; count: number }) {
  const Icon = state === 'synced' ? CheckCircle2 : state === 'syncing' ? Loader2 : state === 'failed' ? AlertTriangle : CloudOff;
  return (
    <span className={`sync sync-${state}`} role="status">
      <Icon size={14} className={state === 'syncing' ? 'spin' : undefined} />
      {SYNC_LABEL[state]}{count > 0 && state !== 'failed' ? ` (${count})` : ''}
    </span>
  );
}

const tabFromHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return TABS.some(([id]) => id === hash) ? (hash as Tab) : 'dashboard';
};

export function AppWithSupabase({ email, userId }: { email: string; userId: string }) {
  const repo = useMemo(() => supabaseRepo(createClient(), userId), [userId]);
  return <App repo={repo} email={email} userId={userId} />;
}

export function App({ repo, email, userId }: { repo: Repo; email: string; userId: string }) {
  const ledger = useLedger(repo, userId);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [openDate, setOpenDate] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  function go(next: Tab) {
    window.history.pushState(null, '', `#${next}`);
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  if (!ledger.ready) {
    return <main className="splash"><Wallet size={36} /><p>Memuatkan…</p></main>;
  }

  if (!ledger.branch && !ledger.branches.some(b => !b.archived_at)) {
    return <Onboarding repo={repo} online={ledger.online} loadError={ledger.loadError} onDone={ledger.refresh} email={email} />;
  }
  const branch = ledger.branch!;
  const usable = ledger.branches.filter(b => !b.archived_at);
  const balance = ledger.days.at(-1)?.balance ?? branch.opening_balance_sen;
  const currentPeriod = periodOf(todayKL());
  const purchases = summarisePeriod(branch.opening_balance_sen, ledger.days, currentPeriod).purchases;
  // Same figure as the Dashboard's "terkumpul": carried up to the current month.
  const cumulative = profitFor(ledger.months, currentPeriod, branch).final;
  const branchPicker = usable.length > 1 ? (
    <select className="branch-select" aria-label="Pilih cawangan" value={branch.id} onChange={e => void ledger.switchBranch(e.target.value)}>
      {usable.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  ) : <strong className="branch-name">{branch.name}</strong>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Wallet size={20} /> Rekod Modal</div>
        {branchPicker}
        <div className="side-balance">
          <span>Baki modal</span>
          <strong className={balance < 0 ? 'negative' : undefined}>{money(balance)}</strong>
          <dl>
            <div><dt>Belian {periodShortLabel(currentPeriod)}</dt><dd>{money(purchases)}</dd></div>
            <div><dt>{cumulative < 0 ? 'Rugi' : 'Untung'} bersih terkumpul</dt><dd className={cumulative < 0 ? 'negative' : cumulative > 0 ? 'positive' : undefined}>{money(cumulative)}</dd></div>
          </dl>
        </div>
        <button className="btn btn-primary side-add" onClick={() => go('harian')}><Plus size={17} /> Isi rekod hari ini</button>
        <nav className="side-nav" aria-label="Navigasi utama">
          {SIDE_GROUPS.map(([heading, ids]) => (
            <div key={heading}>
              <span className="nav-heading">{heading}</span>
              {TABS.filter(([id]) => ids.includes(id)).map(([id, label, Icon]) => (
                <button key={id} className="nav-item" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <SyncBadge state={ledger.sync} count={ledger.pendingCount} />
          <button className="nav-item" aria-current={tab === 'tetapan' ? 'page' : undefined} onClick={() => go('tetapan')}>
            <Settings size={18} /> Tetapan
          </button>
          <div className="account"><span aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span><small>{email}</small></div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {branchPicker}
          <SyncBadge state={ledger.sync} count={ledger.pendingCount} />
        </header>

        {/* The sidebar's summary, for phones where the sidebar is hidden. */}
        <dl className="top-stats mobile-only">
          <div><dt>Baki modal</dt><dd className={balance < 0 ? 'negative' : undefined}>{money(balance)}</dd></div>
          <div><dt>Belian {periodShortLabel(currentPeriod)}</dt><dd>{money(purchases)}</dd></div>
          <div><dt>{cumulative < 0 ? 'Rugi' : 'Untung'} terkumpul</dt><dd className={cumulative < 0 ? 'negative' : cumulative > 0 ? 'positive' : undefined}>{money(cumulative)}</dd></div>
        </dl>

        <main className="content">
          {ledger.loadError && <div className="alert alert-error" role="alert">{ledger.loadError}</div>}
          {ledger.failed.map(({ txn, failed }) => (
            <div className="alert alert-error" role="alert" key={txn.id}>
              <span>Rekod {txn.txn_date} tidak dapat disimpan: {failed}</span>
              <button className="btn btn-small" onClick={() => ledger.discardFailed(txn.id)}>Buang</button>
            </div>
          ))}
          {tab === 'dashboard' && <DashboardView ledger={ledger} branch={branch} repo={repo} onAdd={() => go('harian')} onMonth={() => go('bulanan')} />}
          {tab === 'harian' && <TodayView ledger={ledger} branch={branch} openDate={openDate} onDateUsed={() => setOpenDate(null)} />}
          {tab === 'sejarah' && <RecordsView ledger={ledger} branch={branch} onOpenDay={date => { setOpenDate(date); go('harian'); }} />}
          {tab === 'bulanan' && <MonthView ledger={ledger} branch={branch} repo={repo} />}
          {tab === 'tetapan' && <SettingsView ledger={ledger} branch={branch} repo={repo} email={email} userId={userId} />}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navigasi utama">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon size={21} /> <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
