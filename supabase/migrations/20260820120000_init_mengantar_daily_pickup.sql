-- supabase/migrations/20260820120000_init_mengantar_daily_pickup.sql
-- Jadwal pickup harian Mengantar: satu time_id per TANGGAL PICKUP, dibuat sekali lalu dipakai
-- ulang oleh semua order hari itu.
--
-- Latar belakang: membuat booking kurir butuh `time_id` dari endpoint POST /time Mengantar.
-- Memanggilnya per transaksi berarti satu panggilan API tambahan tiap checkout — lambat, boros
-- kuota, dan menambah satu titik gagal di jalur bayar. Tabel ini memindahkan panggilan itu ke
-- cron harian; checkout hanya MEMBACA.
--
-- Sebelum tabel ini, jadwal pickup dipegang env MENGANTAR_PICKUP_TIME_ID (satu id statis untuk
-- selamanya). Id itu tetap dipertahankan sebagai cadangan lapis terakhir, bukan sumber utama.

create table if not exists public.mengantar_daily_pickup (
  id         uuid primary key default gen_random_uuid(),
  -- Tanggal PICKUP dalam zona WIB, format YYYY-MM-DD (bukan tanggal pembuatan baris).
  -- UNIQUE wajib: itulah yang membuat "sudah ada -> jangan generate ulang" aman dari race.
  -- Tanpa unique, cron yang re-run bersamaan dengan fallback checkout bisa menyisipkan dua baris
  -- untuk tanggal yang sama dan dua order berangkat dengan time_id berbeda.
  date       date not null unique,
  -- time_id dari Mengantar (ObjectId 24 hex). Disimpan text, bukan uuid — bukan UUID.
  time_id    text not null,
  created_at timestamptz not null default now()
);

comment on table public.mengantar_daily_pickup is
  'Satu time_id pickup Mengantar per tanggal WIB. Diisi cron harian (06:00 WIB) atau oleh '
  'fallback saat checkout bila cron untuk tanggal itu belum jalan. Dibaca lewat '
  'getTodayPickupTimeId() di src/lib/mengantar-pickup.ts.';

comment on column public.mengantar_daily_pickup.date is
  'Tanggal PICKUP (zona WIB), bukan tanggal baris dibuat. Order setelah cutoff 15:00 WIB memakai '
  'baris hari kerja BERIKUTNYA.';

-- === RLS ===
-- Aktif TANPA policy publik, pola sama dengan orders/admin_users/store_settings: berisi data
-- operasional pengiriman yang tak ada urusannya dengan browser pembeli. Semua baca/tulis lewat
-- server (service_role, menembus RLS).
alter table public.mengantar_daily_pickup enable row level security;
