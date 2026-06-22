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

## Verifikasi hasil

- Menu **Table Editor** → cek tabel muncul dengan kolom yang benar.
- Menu **Authentication → Policies** (atau Table Editor → RLS) → cek RLS aktif & policy ada.

## Catatan migrasi ke CLI nanti

Saat CLI Supabase sudah terpasang (Scoop / binary standalone), file di folder ini
sudah siap dipakai `supabase db push` tanpa perubahan. Generate types dengan:

```
supabase gen types typescript --linked > src/types/supabase.ts
```
