# Rekod Modal

PWA untuk rekod modal harian, report WhatsApp, dan penutupan bulanan bagi banyak cawangan. Satu codebase untuk desktop, laptop, Android dan iPhone. Dibina dengan Next.js, Supabase dan Vercel.

Tempoh akaun bermula 25 haribulan hingga 24 bulan berikutnya: 25 Sep – 24 Okt ialah tempoh `2026-10`.

## Setup Supabase

1. Dalam SQL Editor, jalankan fail dalam `supabase/migrations/`.
2. **Authentication → Sign In / Providers**: matikan **Allow new users to sign up**. Halaman login tiada pendaftaran, tetapi API masih menerimanya selagi tetapan ini hidup.
3. **Authentication → Users**: cipta akaun untuk setiap pengguna.
4. Salin Project URL dan Publishable key dari dialog **Connect**.

Jangan masukkan `service_role` atau secret key ke frontend.

## Development

```bash
npm ci
npm run dev
```

`.env.local` (diabaikan Git):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Jika `node_modules` disalin dari komputer lain, padam dan jalankan `npm ci` semula, kerana sesetengah pakej bergantung pada sistem operasi.

Semak sebelum push: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. `npm test` menjalankan migrasi sebenar pada Postgres dalam memori (PGlite).

## Deploy

Import repo ke Vercel sebagai projek Next.js dan tambah dua environment variable di atas. Dalam Supabase **Authentication → URL Configuration**, tetapkan Site URL kepada domain production.

Vercel Functions dikunci ke `sin1` melalui `vercel.json`. Untuk latency terbaik, projek Supabase juga perlu di `ap-southeast-1`.

## Peranan

- **Pemilik**: semua, termasuk data bulanan, tutup bulan, urus cawangan dan ahli.
- **Staf**: tambah dan ubah rekod harian, lihat semua data cawangan.

Bulan yang ditutup mengunci semua rekod dalam tempoh itu dan modal permulaan cawangan. Rekod dibuang secara lembut (`voided_at`), cawangan diarkibkan, dan setiap perubahan masuk `audit_log`.

## PWA dan offline

- Service worker hanya didaftarkan dalam production, supaya tidak mengganggu projek lain di localhost.
- Rekod harian boleh ditambah semasa offline, disimpan dalam peranti, dan dihantar bila online. Data bulanan dan tetapan perlukan internet.
- Log keluar membuang data dan cache dari peranti.

## Struktur

- `components/` — skrin dan komponen UI
- `lib/ledger.ts` — kiraan baki, tempoh dan report
- `lib/repo.ts` — semua akses data
- `lib/use-ledger.ts` — keadaan app, cache dan barisan offline
- `public/sw.js`, `app/manifest.ts` — PWA
- `supabase/migrations/` — schema dan RLS
