-- supabase/migrations/20261014120000_pickup_slot_per_jam.sql
-- Slot penjemputan Mengantar kini dibedakan per JAM JEMPUT: satu tanggal & satu alamat gudang boleh
-- punya beberapa slot (mis. J&T 17.00 dan Shopee Express 14.00 pada hari yang sama).
--
-- ── Kenapa perlu ──
-- Sejak 2026-10-14 admin bisa mengatur jam jemput PER EKSPEDISI di OMS → Pengaturan → Jam
-- Penjemputan. Slot Mengantar (time_id dari POST /time) dibuat untuk satu alamat, satu tanggal, dan
-- SATU JAM. Dengan unique (date, address_id) yang lama, tanggal yang sudah punya slot 17.00 tak bisa
-- mendapat slot 14.00 — booking SPX akan ikut slot 17.00 dan kurir datang di jam yang salah.
--
-- ── Isi kolom ──
-- pickup_hour = jam jemput (WIB, 9–18) yang dikirim ke POST /time saat slot dibuat. Baris lama
-- diisi 17: sampai PR #67 (2026-10-13) semua slot dibuat dengan jam 17.00. Slot yang sempat dibuat
-- dengan jam khusus setelah PR #67 ikut terisi 17 — jalankan file ini saat tak ada jam khusus aktif
-- untuk hari ini/besok, atau hapus dulu baris slot tanggal itu (booking berikutnya membuat ulang).
--
-- ── Kalau migration ini belum dijalankan ──
-- Kode membaca/menulis tanpa kolom ini (menangkap 42703/PGRST204): satu slot per tanggal seperti
-- sebelumnya, dan jam per ekspedisi BELUM berlaku untuk slot (tab Jam Penjemputan menampilkan
-- peringatannya). Cutoff per ekspedisi tetap berlaku karena tak menyentuh tabel ini.

alter table public.mengantar_daily_pickup
  add column if not exists pickup_hour smallint;

update public.mengantar_daily_pickup
   set pickup_hour = 17
 where pickup_hour is null;

-- Default 17 menjaga kode versi lama (yang belum mengirim pickup_hour) tetap menulis baris sah
-- selama jeda antara migration dijalankan dan deploy baru selesai.
alter table public.mengantar_daily_pickup
  alter column pickup_hour set default 17;

alter table public.mengantar_daily_pickup
  alter column pickup_hour set not null;

alter table public.mengantar_daily_pickup
  drop constraint if exists mengantar_daily_pickup_pickup_hour_check;
alter table public.mengantar_daily_pickup
  add constraint mengantar_daily_pickup_pickup_hour_check check (pickup_hour between 9 and 18);

-- Kunci baru: satu slot per tanggal, alamat, DAN jam. Index baru dibuat dulu, baru yang lama dicabut,
-- supaya tak ada jeda tanpa penjaga duplikat.
create unique index if not exists mengantar_daily_pickup_date_address_hour_idx
  on public.mengantar_daily_pickup (date, address_id, pickup_hour);

drop index if exists public.mengantar_daily_pickup_date_address_idx;

comment on column public.mengantar_daily_pickup.pickup_hour is
  'Jam jemput (WIB, 9–18) yang diminta ke Mengantar saat slot ini dibuat. Satu tanggal & alamat bisa '
  'punya beberapa slot bila jam jemput per ekspedisi berbeda (OMS → Pengaturan → Jam Penjemputan).';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20261014120000_pickup_slot_per_jam', 'mengantar_daily_pickup.pickup_hour: slot per jam jemput (jam per ekspedisi)')
--     on conflict (version) do nothing;
