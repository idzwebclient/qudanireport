'use client';
import { useEffect, useState } from 'react';
import { Download, Pencil, Share, Trash2 } from 'lucide-react';
import { money } from '../lib/ledger';
import type { Branch, Member, OpexCategory, Repo, Role } from '../lib/repo';
import { clearLocalData, outboxCount, type useLedger } from '../lib/use-ledger';
import { OpeningFields, useOpeningForm } from './opening-fields';

type InstallPrompt = Event & { prompt: () => Promise<void> };

function useAction(onDone: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await onDone();
      setMessage({ ok: true, text: done });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

const Message = ({ message }: { message: { ok: boolean; text: string } | null }) =>
  message && <div className={`alert ${message.ok ? 'alert-ok' : 'alert-error'}`} role="status">{message.text}</div>;

function BranchCard({ branch, repo, recordDates, onDone }: { branch: Branch; repo: Repo; recordDates: string[]; onDone: () => Promise<void> }) {
  const [name, setName] = useState(branch.name);
  const form = useOpeningForm(branch);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [invalid, setInvalid] = useState('');
  const { busy, message, run } = useAction(onDone);
  const isOwner = branch.role === 'owner';
  const skipped = form.openingDate ? recordDates.filter(d => d < form.openingDate).length : 0;

  function save() {
    if (!name.trim()) return setInvalid('Masukkan nama cawangan.');
    const result = form.read();
    if ('error' in result) return setInvalid(result.error);
    setInvalid('');
    void run(() => repo.updateBranch(branch.id, { name: name.trim(), ...result.values }), 'Cawangan dikemas kini.');
  }

  return (
    <section className="card stack">
      <h2 className="card-title">Cawangan ini</h2>
      <label className="field">
        <span>Nama</span>
        <input maxLength={120} value={name} disabled={!isOwner} onChange={e => setName(e.target.value)} />
      </label>
      <OpeningFields form={form} disabled={!isOwner} warning={skipped > 0 ? `${skipped} rekod sebelum tarikh ini tidak akan dikira dalam baki. Rekod itu tidak dipadam.` : undefined} />
      {invalid && <div className="alert alert-error" role="alert">{invalid}</div>}
      <Message message={message} />
      {isOwner ? (
        <>
          <button className="btn btn-primary" disabled={busy} onClick={save}>Simpan</button>
          {confirmArchive ? (
            <div className="confirm">
              <span>Arkibkan {branch.name}? Rekod tidak dipadam dan boleh dipulihkan.</span>
              <button className="btn btn-danger" disabled={busy} onClick={() => void run(() => repo.updateBranch(branch.id, { archived_at: new Date().toISOString() }), 'Cawangan diarkibkan.')}>Ya, arkibkan</button>
              <button className="btn" onClick={() => setConfirmArchive(false)}>Batal</button>
            </div>
          ) : <button className="btn btn-ghost-danger" onClick={() => setConfirmArchive(true)}>Arkibkan cawangan</button>}
        </>
      ) : <p className="muted">Hanya pemilik boleh mengubah cawangan.</p>}
    </section>
  );
}

function OpexList({ branch, categories, repo, onDone }: { branch: Branch; categories: OpexCategory[]; repo: Repo; onDone: () => Promise<void> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [newName, setNewName] = useState('');
  const { busy, message, run } = useAction(onDone);
  const isOwner = branch.role === 'owner';
  const target = categories.find(c => c.id !== editingId && c.name.toLowerCase() === text.trim().toLowerCase());

  async function rename(id: string) {
    if (!text.trim()) return;
    if (await run(() => repo.renameOpexCategory(id, text.trim()), target ? `Item digabung ke ${target.name}.` : 'Nama item ditukar.')) setEditingId(null);
  }

  async function add() {
    if (await run(() => repo.addOpexCategory(branch.id, newName.trim()), 'Item ditambah.')) setNewName('');
  }

  return (
    <section className="card stack">
      <h2 className="card-title">Item OPEX</h2>
      <p className="muted">Senarai ini keluar sebagai dropdown di Bulanan. Tukar nama sebuah item kepada nama item lain untuk menggabungkan kedua-duanya, termasuk bulan lepas.</p>
      {categories.length ? (
        <ul className="member-list">
          {categories.map(c => (
            <li key={c.id}>
              {editingId === c.id ? (
                <div className="opex-edit stack">
                  <input aria-label={`Nama baru untuk ${c.name}`} maxLength={120} value={text} onChange={e => setText(e.target.value)} />
                  {target && <div className="alert alert-warn">{c.name} akan digabung ke {target.name}, termasuk semua bulan lepas.</div>}
                  <div className="form-secondary">
                    <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void rename(c.id)}>{target ? 'Gabung' : 'Simpan'}</button>
                    <button className="btn" onClick={() => setEditingId(null)}>Batal</button>
                  </div>
                </div>
              ) : (
                <>
                  <span>{c.name}</span>
                  {isOwner && (
                    <span className="row-actions">
                      <button className="icon-btn" aria-label={`Ubah ${c.name}`} onClick={() => { setEditingId(c.id); setText(c.name); }}><Pencil size={17} /></button>
                      <button className="icon-btn" aria-label={`Buang ${c.name} dari senarai`} disabled={busy} onClick={() => void run(() => repo.deleteOpexCategory(c.id), `${c.name} dibuang dari senarai. Angka bulan lepas kekal.`)}><Trash2 size={17} /></button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Belum ada item.</p>}
      {isOwner && (
        <>
          <label className="field"><span>Item baru</span><input maxLength={120} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Contoh: Sewa" /></label>
          <button className="btn" disabled={busy || !newName.trim()} onClick={() => void add()}>Tambah item</button>
        </>
      )}
      <Message message={message} />
    </section>
  );
}

function NewBranch({ repo, onCreated }: { repo: Repo; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const form = useOpeningForm();
  const [invalid, setInvalid] = useState('');
  const { busy, message, run } = useAction(async () => {});

  async function add() {
    const result = form.read(true);
    if ('error' in result) return setInvalid(result.error);
    setInvalid('');
    const created = await run(async () => {
      const id = await repo.createBranch(name.trim(), result.values.opening_balance_sen);
      await repo.updateBranch(id, result.values);
      await onCreated(id);
    }, 'Cawangan ditambah dan dibuka.');
    if (created) {
      setName('');
      form.reset();
    }
  }

  return (
    <section className="card stack">
      <h2 className="card-title">Tambah cawangan</h2>
      <label className="field"><span>Nama</span><input maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Sungai Petani" /></label>
      <OpeningFields form={form} />
      {invalid && <div className="alert alert-error" role="alert">{invalid}</div>}
      <Message message={message} />
      <button className="btn" disabled={busy || !name.trim()} onClick={() => void add()}>Tambah cawangan</button>
    </section>
  );
}

function Members({ branch, repo, online }: { branch: Branch; repo: Repo; online: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const reload = async () => setMembers(await repo.listMembers(branch.id));
  const { busy, message, run } = useAction(reload);
  const isOwner = branch.role === 'owner';

  useEffect(() => {
    if (!online) return;
    let live = true;
    repo.listMembers(branch.id).then(list => { if (live) setMembers(list); }).catch(() => {});
    return () => { live = false; };
  }, [repo, branch.id, online]);

  return (
    <section className="card stack">
      <h2 className="card-title">Ahli cawangan</h2>
      {members === null ? <p className="muted">{online ? 'Memuatkan…' : 'Perlu sambungan internet.'}</p> : (
        <ul className="member-list">
          {members.map(m => (
            <li key={m.user_id}>
              <span>{m.email}<small>{m.role === 'owner' ? 'Pemilik' : 'Staf'}</small></span>
              {isOwner && <button className="icon-btn" aria-label={`Buang ${m.email}`} disabled={busy} onClick={() => void run(() => repo.removeMember(branch.id, m.user_id), 'Ahli dibuang.')}><Trash2 size={17} /></button>}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <>
          <label className="field"><span>E-mel akaun</span><input type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="staf@syarikat.com" /></label>
          <div className="segmented" role="group" aria-label="Peranan">
            <button type="button" aria-pressed={role === 'staff'} onClick={() => setRole('staff')}>Staf</button>
            <button type="button" aria-pressed={role === 'owner'} onClick={() => setRole('owner')}>Pemilik</button>
          </div>
          <button className="btn" disabled={busy || !online || !email.trim()} onClick={() => void run(() => repo.addMember(branch.id, email, role), 'Ahli ditambah.').then(ok => { if (ok) setEmail(''); })}>Tambah ahli</button>
          <p className="muted">Akaun mesti dicipta dahulu dalam Supabase. Staf boleh merekod; pemilik boleh tutup bulan dan urus cawangan.</p>
        </>
      )}
      <Message message={message} />
    </section>
  );
}

function Archived({ branches, repo, onDone }: { branches: Branch[]; repo: Repo; onDone: () => Promise<void> }) {
  const { busy, message, run } = useAction(onDone);
  if (!branches.length) return null;
  return (
    <section className="card stack">
      <h2 className="card-title">Arkib</h2>
      <ul className="member-list">
        {branches.map(b => (
          <li key={b.id}>
            <span>{b.name}<small>Modal permulaan {money(b.opening_balance_sen)}</small></span>
            {b.role === 'owner' && <button className="btn btn-small" disabled={busy} onClick={() => void run(() => repo.updateBranch(b.id, { archived_at: null }), 'Cawangan dipulihkan.')}>Pulihkan</button>}
          </li>
        ))}
      </ul>
      <Message message={message} />
    </section>
  );
}

function Install() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [platform, setPlatform] = useState<'ios' | 'other' | 'installed'>('other');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const detect = () => setPlatform(standalone ? 'installed' : ios ? 'ios' : 'other');
    detect();
    const capture = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  if (platform === 'installed') return null;
  return (
    <section className="card stack">
      <h2 className="card-title">Pasang app</h2>
      {platform === 'ios' ? (
        <p className="muted">Buka dalam Safari, tekan <Share size={14} className="inline-icon" /> Kongsi, kemudian <b>Add to Home Screen</b>.</p>
      ) : prompt ? (
        <button className="btn btn-primary" onClick={() => { void prompt.prompt(); setPrompt(null); }}><Download size={16} /> Pasang Rekod Modal</button>
      ) : (
        <p className="muted">Android: menu Chrome → <b>Add to Home screen</b>. Desktop: ikon pasang di bar alamat Chrome atau Edge.</p>
      )}
    </section>
  );
}

export function SettingsView({ ledger, branch, repo, email, userId }: {
  ledger: ReturnType<typeof useLedger>;
  branch: Branch;
  repo: Repo;
  email: string;
  userId: string;
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Clears this person's data from the device so the next user on it cannot read it.
  async function clearDevice() {
    clearLocalData(userId);
    if ('caches' in window) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
  }

  return (
    <div className="stack">
      <div className="page-title"><div><h1>Tetapan</h1></div></div>
      <div className="settings-grid">
      <BranchCard key={`branch:${branch.id}`} branch={branch} repo={repo} recordDates={ledger.txns.filter(t => !t.voided_at).map(t => t.txn_date)} onDone={ledger.refresh} />
      <Members key={`members:${branch.id}`} branch={branch} repo={repo} online={ledger.online} />
      <OpexList key={`opex:${branch.id}`} branch={branch} categories={ledger.categories} repo={repo} onDone={ledger.refresh} />
      <NewBranch repo={repo} onCreated={ledger.switchBranch} />
      <Archived branches={ledger.branches.filter(b => b.archived_at)} repo={repo} onDone={ledger.refresh} />
      <Install />
      <section className="card stack">
        <h2 className="card-title">Akaun</h2>
        <p className="muted">{email}</p>
        <form action="/auth/signout" method="post" className="stack" onSubmit={e => {
          if (outboxCount(userId) > 0 && !confirmLogout) {
            e.preventDefault();
            setConfirmLogout(true);
            return;
          }
          e.preventDefault();
          const form = e.currentTarget;
          void clearDevice().finally(() => form.submit());
        }}>
          {confirmLogout && <div className="alert alert-warn">{outboxCount(userId)} rekod belum dihantar dan akan hilang jika log keluar. Tekan sekali lagi untuk teruskan.</div>}
          <button className="btn">Log keluar</button>
        </form>
      </section>
      </div>
    </div>
  );
}
