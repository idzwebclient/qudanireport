import { redirect } from 'next/navigation';
import { AppWithSupabase } from '../components/app';
import { createClient } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect('/login');
  return <AppWithSupabase userId={claims.sub} email={typeof claims.email === 'string' ? claims.email : 'Akaun pengguna'} />;
}
