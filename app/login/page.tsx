import { redirect } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { createClient } from '../../lib/supabase/server';
import { login } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect('/');
  const params = await searchParams;
  return (
    <main className="center-page">
      <form className="card stack onboarding" action={login}>
        <div className="brand brand-ink"><Wallet size={20} /> Rekod Modal</div>
        <h1>Log masuk</h1>
        {params.error && <div className="alert alert-error" role="alert">{params.error}</div>}
        <label className="field">
          <span>E-mel</span>
          <input name="email" type="email" autoComplete="email" required placeholder="nama@syarikat.com" />
        </label>
        <label className="field">
          <span>Kata laluan</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary">Log masuk</button>
        <p className="muted">Akaun baru dicipta oleh pemilik sistem.</p>
      </form>
    </main>
  );
}
