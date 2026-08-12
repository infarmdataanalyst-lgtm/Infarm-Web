-- supabase/migrations/20260814120000_add_admin_users_role.sql
-- Peran akun OMS. Dipakai membatasi siapa yang boleh MENGUBAH stok gudang.
--
-- Kenapa ada: halaman "Kelola Stok Gudang" bisa mengubah angka yang langsung terlihat pembeli dan
-- langsung menentukan pesanan bisa masuk atau tidak. Sebelum ini, siapa pun yang bisa login OMS
-- bisa menimpanya. Sekarang perubahan stok butuh peran 'admin'.
--
-- Peran yang ada sekarang (sengaja hanya dua — tambah nilai baru = ubah CHECK di bawah):
--   admin → akses penuh, termasuk menulis stok
--   staff → boleh MELIHAT stok (dan halaman OMS lain), TIDAK boleh menulis stok
--
-- DEFAULT 'admin' disengaja: akun yang sudah ada (admin@infarm.id) harus tetap punya akses penuh
-- setelah migration ini dijalankan. Akun baru yang hanya perlu melihat dibuat dengan role 'staff'.

alter table public.admin_users
  add column if not exists role text not null default 'admin';

-- Constraint ditambah terpisah agar migration tetap idempotent bila kolomnya sudah ada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_users_role_check'
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check check (role in ('admin', 'staff'));
  end if;
end $$;

comment on column public.admin_users.role is
  'Peran akun OMS: admin (akses penuh, boleh menulis stok) | staff (hanya melihat stok).';
