-- supabase/migrations/20260922120200_pickup_slot_alamat_wajib.sql
-- FASE B dari pemisahan slot pickup per alamat. Mencabut jembatan sementara yang dipasang fase A
-- (20260922120100), sehingga `address_id` menjadi WAJIB diisi penulisnya.
--
-- === KENAPA ADA DUA FASE ===
-- Fase A dijalankan SEBELUM kode baru dideploy, jadi ia harus tetap bisa dilayani kode LAMA yang
-- masih menulis insert({date, time_id}) tanpa address_id. Untuk itu kolomnya dibuat nullable dan
-- diberi DEFAULT alamat lama (Cengkareng, 6a83baf39124abb5652fa63a): insert kode lama tetap sah
-- dan tetap mendarat di alamat yang benar, karena saat itu akun memang hanya punya satu alamat.
--
-- Kode baru (PR #12, live sejak 22 Sep 2026) SELALU menyebut address_id secara eksplisit
-- (lihat savePickup di src/lib/mock-db/pickup.ts). Jadi nilai bawaan itu tak lagi dipakai siapa
-- pun — yang tersisa hanyalah bahayanya.
--
-- === KENAPA NILAI BAWAAN ITU BERBAHAYA SETELAH MODE MULTI MENYALA ===
-- Begitu MENGANTAR_PICKUP_ORIGIN_ID dicabut, tiap gudang punya alamat penjemputannya sendiri dan
-- tabel ini berisi slot untuk BEBERAPA alamat per tanggal. Dengan DEFAULT masih terpasang, setiap
-- penulisan yang lupa menyebut alamat — jalur kode baru, script perbaikan, atau insert manual lewat
-- SQL Editor — tidak ditolak. Barisnya diam-diam dicap milik Cengkareng.
--
-- Akibatnya paket dari gudang lain terdaftar pada jadwal penjemputan gudang yang salah, dan
-- Mengantar TIDAK menolak pasangan (alamat, slot) yang keliru: uji sandbox 22 Sep 2026
-- (Notion Testing Mengantar MGT-57) mengirim address_id Cengkareng berpasangan dengan time_id milik
-- alamat lain, dan booking DITERIMA tanpa error. Jadi satu-satunya penjaga adalah tabel ini.
--
-- Mencabut DEFAULT mengubah kelalaian senyap menjadi galat yang langsung terlihat.
--
-- === KENAPA NOT NULL, BUKAN CUKUP DROP DEFAULT ===
-- Tanpa nilai bawaan, insert yang lupa akan menyimpan NULL. NULL sama berbahayanya: baris seperti
-- itu tak akan pernah cocok dengan getPickupByDate(date, addressId) mana pun, sehingga slotnya
-- "hilang" dan setiap booking hari itu jatuh ke jalur cadangan tanpa satu pun pesan galat. NOT NULL
-- membuat kesalahannya berhenti di titik penulisan, bukan mengendap sebagai data yang tak terpakai.
--
-- === PRASYARAT (sudah diverifikasi 23 Sep 2026) ===
--   1. Tidak ada baris ber-address_id NULL:
--        select count(*) from public.mengantar_daily_pickup where address_id is null;  -- hasil: 0
--   2. Deployment produksi sudah memakai kode PR #12 — terpenuhi sejak 22 Sep 2026.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

-- Jaring pengaman: kalau ternyata masih ada baris tanpa alamat, berhenti dengan pesan yang
-- menyebutkan jumlahnya — jangan sampai `set not null` gagal dengan galat Postgres yang tak
-- menjelaskan apa yang harus diperbaiki.
do $$
declare
  v_kosong bigint;
begin
  select count(*) into v_kosong
    from public.mengantar_daily_pickup
   where address_id is null;

  if v_kosong > 0 then
    raise exception
      'Masih ada % baris mengantar_daily_pickup tanpa address_id. Isi dulu alamat pemiliknya '
      '(lihat warehouses.mengantar_address_id), baru jalankan migration ini.', v_kosong;
  end if;
end $$;

-- Jembatan untuk kode lama DICABUT. Sejak sini, penulis WAJIB menyebut alamatnya sendiri.
alter table public.mengantar_daily_pickup
  alter column address_id drop default;

alter table public.mengantar_daily_pickup
  alter column address_id set not null;

comment on column public.mengantar_daily_pickup.address_id is
  '_id alamat penjemputan Mengantar (warehouses.mengantar_address_id) yang memiliki slot ini. '
  'WAJIB diisi penulisnya sejak fase B (20260922120200) — tak ada lagi nilai bawaan. Mengantar '
  'menerima pasangan address_id/time_id yang tak cocok tanpa error (MGT-57), jadi kolom inilah '
  'yang menjaga slot tetap terikat ke alamatnya.';

-- =================================================================================================
-- VERIFIKASI SESUDAH MENJALANKAN (jalankan terpisah)
-- =================================================================================================
--
-- 1. Kolomnya wajib dan tanpa nilai bawaan:
--      select column_name, is_nullable, column_default
--        from information_schema.columns
--       where table_schema = 'public'
--         and table_name   = 'mengantar_daily_pickup'
--         and column_name  = 'address_id';
--      -> is_nullable = 'NO', column_default = NULL
--
-- 2. Insert tanpa alamat kini DITOLAK (jalankan untuk membuktikan, lalu abaikan galatnya):
--      insert into public.mengantar_daily_pickup (date, time_id) values ('2099-01-01', 'uji');
--      -> harus galat: null value in column "address_id" ... violates not-null constraint
--
-- 3. Slot yang sudah ada tetap utuh:
--      select date, address_id, time_id from public.mengantar_daily_pickup order by date desc limit 5;
