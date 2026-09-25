# Supabase — Migrations

Folder ini menyimpan **migration SQL** sebagai sumber kebenaran skema database
(lihat aturan di `CLAUDE.md`). Selama Supabase CLI belum dipasang di mesin Windows ini,
migration dijalankan **manual lewat Dashboard → SQL Editor**.

## Cara menjalankan sebuah migration

1. Buka Supabase Dashboard → project Anda → menu **SQL Editor**.
2. Klik **New query**.
3. Buka file migration di `supabase/migrations/` (urut berdasarkan nama/timestamp),
   copy seluruh isinya, paste ke editor.
4. Klik **Run**. Pastikan tidak ada error.
5. Jalankan migration **berurutan** (timestamp paling lama lebih dulu) bila ada lebih dari satu.
6. **Catat di ledger** (langkah ini wajib — lihat bagian berikutnya).

## ⚠️ Catat setiap migration yang dijalankan

Tanpa CLI, tidak ada apa pun yang tahu file mana sudah dijalankan. Karena itu ada tabel
`public.schema_migrations` (dibuat oleh `20260907120100_ledger_migration.sql`). **Isi tangan**
setiap kali Anda menjalankan sebuah file:

```sql
insert into public.schema_migrations (version, note)
values ('20260907120000_policy_anon_combos_promotions', 'dijalankan manual')
on conflict (version) do nothing;
```

Melihat apa yang sudah tercatat:

```sql
select version, applied_at, note from public.schema_migrations order by version;
```

**Kenapa langkah ini tidak boleh dilewati.** `20260622100100_init_order_items.sql` memuat
`alter table ... enable row level security`, dan selama berbulan-bulan semua orang mengira itu
sudah berjalan. Uji dengan anon key pada 2026-09-04 membuktikan sebaliknya: `public.order_items`
membalas 200 untuk SELECT, PATCH, **dan** DELETE, dan seluruh 75 barisnya terbaca publik. Tabelnya
ternyata pernah dibuat manual di Dashboard di luar riwayat migration, sehingga baris RLS itu tak
pernah dieksekusi — dan tak ada apa pun di repo yang bisa memberi tahu kita. Itulah SEC-036, dan
lubangnya bukan pada SQL-nya melainkan pada tidak adanya catatan.

Kalau ragu sebuah file sudah jalan atau belum: **jangan dicatat**. Ledger yang berbohong lebih
buruk daripada ledger kosong, karena ia menghentikan orang dari memeriksa.

## ⚠️ Tabel & fungsi baru TIDAK otomatis terbuka — beri izin eksplisit

Sejak 2026-09-14 dua "pintu otomatis" sengaja ditutup (SEC-055):

- **Dashboard → Integrations → Data API → Settings → "Automatically expose new tables"
  dimatikan.** Tabel baru tak lagi otomatis diberi izin ke peran Data API — termasuk
  **`service_role`**, bukan hanya `anon`.
- **Fungsi baru**: migration `20260914130000_cabut_execute_fungsi_publik.sql` mengubah default
  privileges supaya fungsi yang lahir tidak bisa dipanggil `anon`/`authenticated`.

Akibatnya, **setiap migration yang membuat tabel atau fungsi baru wajib menulis izinnya sendiri.**
Tanpa itu, fitur baru gagal dengan `permission denied for table …` walau kodenya memakai
`createAdminClient` — service_role memang menembus RLS, tapi tetap butuh izin tabel.

```sql
-- Tabel yang hanya diakses server (pola default proyek ini)
grant select, insert, update, delete on public.nama_tabel to service_role;

-- HANYA bila tabel memang dibaca publik lewat anon key + RLS (mis. ulasan):
-- grant select on public.nama_tabel to anon;

-- Fungsi: cabut dari PUBLIC dulu (PostgreSQL memberinya ke semua orang secara bawaan),
-- lalu beri ke service_role saja.
revoke execute on function public.nama_fungsi(tipe_arg) from public, anon, authenticated;
grant execute on function public.nama_fungsi(tipe_arg) to service_role;
```

Jangan menyalakan kembali tombol auto-expose sebagai jalan pintas. Izin yang ditulis di migration
terbaca saat review; izin yang diberikan diam-diam oleh tombol tidak.

## Verifikasi hasil

- Menu **Table Editor** → cek tabel muncul dengan kolom yang benar.
- Menu **Authentication → Policies** (atau Table Editor → RLS) → cek RLS aktif & policy ada.
- Untuk policy anon, verifikasi yang sesungguhnya adalah **membaca tabel itu dengan anon key** dan
  membandingkan jumlah barisnya dengan hasil service_role. Policy yang tampil di UI belum tentu
  menyaring seperti yang Anda kira.

## Catatan migrasi ke CLI nanti

Saat CLI Supabase sudah terpasang (Scoop / binary standalone), file di folder ini
sudah siap dipakai `supabase db push` tanpa perubahan. Generate types dengan:

```
supabase gen types typescript --linked > src/types/supabase.ts
```
