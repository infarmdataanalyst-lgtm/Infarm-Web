-- supabase/migrations/20261009120000_orders_pickup_date.sql
-- Mencatat JADWAL penjemputan kurir pada tiap pesanan yang dibooking: tanggal slot pickup
-- Mengantar yang dipakai (`pickup_date`, tanggal WIB) dan slotnya (`pickup_time_id`).
--
-- ── Kenapa perlu ──
-- Sampai 2026-10-09 tanggal pickup hanya muncul di LOG booking lalu hilang. Akibatnya:
--   1. Halaman Pesanan tak bisa menjawab "berapa paket yang dijemput hari ini, dari gudang mana"
--      — kartu jadwal penjemputan membutuhkan kolom ini.
--   2. Alarm "paket belum dijemput" terpaksa menebak dari shipment_booked_at + 2 hari
--      (order-issues.ts). Dengan tanggal pickup yang tercatat, alarmnya menjadi tepat: jadwalnya
--      lewat tapi status masih Diproses. Tebakan 2 hari juga SALAH saat libur panjang — paket yang
--      dibooking Jumat dengan jadwal jemput Senin depan akan berbunyi di hari Minggu.
--
-- ── Isi kolom ──
-- Diisi updateShipment (src/lib/mock-db/orders.ts) dari hasil createShipmentOrder, nilainya sama
-- dengan `pickup.date`/`pickup.time_id` yang dikirim ke POST /order Mengantar. NULL untuk pesanan
-- yang dibooking sebelum migration ini, dan SENGAJA TIDAK di-backfill: menurunkannya dari
-- shipment_booked_at harus mengulang aturan cutoff + Minggu + libur di SQL, dan hasilnya tetap
-- tebakan. Pesanan lama tetap ditangani aturan 2 hari yang lama.
--
-- ── Kalau migration ini belum dijalankan ──
-- updateShipment menangkap PGRST204/42703 dan mengulang tanpa kolom tambahan; resi tetap tersimpan,
-- hanya jadwalnya yang tidak tercatat. Kartu jadwal dan alarm jadwal-terlewat diam (tanpa data),
-- tidak merusak apa pun.

alter table public.orders
  add column if not exists pickup_date date;

alter table public.orders
  add column if not exists pickup_time_id text;

comment on column public.orders.pickup_date is
  'Tanggal (WIB) slot penjemputan Mengantar yang dipakai saat booking kurir — hari kurir '
  'dijadwalkan mengambil paket dari gudang. NULL = dibooking sebelum kolom ini ada / belum dibooking.';

comment on column public.orders.pickup_time_id is
  'time_id slot penjemputan Mengantar (mengantar_daily_pickup.time_id) yang dipakai saat booking.';

-- Kartu jadwal & alarm membaca "pesanan dengan pickup_date = tanggal tertentu". Partial: pesanan
-- tanpa jadwal (mayoritas baris lama + semua yang belum dibayar) tak perlu masuk indeks.
create index if not exists orders_pickup_date_idx
  on public.orders (pickup_date)
  where pickup_date is not null;

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20261009120000_orders_pickup_date', 'orders.pickup_date & pickup_time_id: jadwal penjemputan kurir per pesanan')
--     on conflict (version) do nothing;
