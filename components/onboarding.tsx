'use client';
import { useState, type FormEvent } from 'react';
import { Wallet } from 'lucide-react';
import type { Repo } from '../lib/repo';
import { OpeningFields, useOpeningForm } from './opening-fields';

export function Onboarding({ repo, online, loadError, onDone, email }: {
  repo: Repo;
  online: boolean;
  loadError: string;
  onDone: () => Promise<void>;
  email: string;
}) {
  const [name, setName] = useState('');
  const form = useOpeningForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = form.read(true);
    if ('error' in result) return setError(result.error);
    setBusy(true);
    setError('');
    try {
      const id = await repo.createBranch(name.trim(), result.values.opening_balance_sen);
      await repo.updateBranch(id, result.values);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card stack onboarding" onSubmit={submit}>
        <div className="brand brand-ink"><Wallet size={20} /> Rekod Modal</div>
        <div>
          <h1>Mula dengan cawangan pertama</h1>
          <p className="muted">Log masuk sebagai {email}.</p>
        </div>
        {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
        {!online && <div className="alert alert-warn">Perlu sambungan internet untuk cipta cawangan.</div>}
        <label className="field">
          <span>Nama cawangan</span>
          <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Alor Setar" />
        </label>
        <OpeningFields form={form} />
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !online || !name.trim()}>{busy ? 'Menyimpan…' : 'Cipta cawangan'}</button>
      </form>
    </main>
  );
}
