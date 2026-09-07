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
