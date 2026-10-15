-- 20261015120000_orders_meta_pixel_ids.sql
-- Menyimpan penanda Meta Pixel milik pembeli pada pesanannya: `_fbp` (browser) dan `_fbc` (klik iklan).
--
-- ── Kenapa kolom ini perlu ada ──
-- Alasannya sama persis dengan ga_client_id (20260923120000): event `Purchase` TIDAK bisa dikirim
-- dari browser karena pembayaran Xendit asinkron — VA/QRIS lunas berjam-jam kemudian, sering tanpa
-- pembeli kembali ke halaman sukses. Jadi Purchase dikirim dari webhook lewat Conversions API, dan
-- Conversions API butuh penanda browser supaya Meta tahu pembelian ini milik pengunjung yang mana.
--
-- Keduanya menjawab pertanyaan berbeda:
--   _fbp → browser mana (pengunjung yang pixel-nya sudah lihat) — cukup untuk mencocokkan pembeli
--   _fbc → IKLAN mana yang diklik (hanya ada bila pengunjung tiba lewat ?fbclid=…) — inilah yang
--          membuat ROAS per iklan bisa dihitung. Tanpa ini pembelian tercatat tapi tak teratribusi.
--
-- ── Kenapa kolom terpisah, bukan lewat RPC create_order_with_items ──
-- Sama dengan ga_client_id: data analitik, bukan uang; ditulis lewat UPDATE terpisah SETELAH
-- pesanan tersimpan (attachAnalyticsIdentifiers), jadi kegagalannya paling buruk = satu pesanan
-- kehilangan atribusi iklan — bukan checkout gagal.
--
-- NULLABLE dan tanpa default: pembeli yang memblokir pixel, tak datang dari iklan (_fbc), atau
-- pesanan sebelum migration ini — semuanya sah.

alter table public.orders
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text;

comment on column public.orders.meta_fbp is
  'Cookie _fbp Meta Pixel pembeli (bentuk "fb.1.<ms>.<acak>"). Dipakai webhook Xendit untuk '
  'mengirim event Purchase lewat Conversions API. NULL = pixel diblokir / belum dipasang / pesanan '
  'lama — bukan kesalahan.';

comment on column public.orders.meta_fbc is
  'Cookie _fbc Meta Pixel pembeli (bentuk "fb.1.<ms>.<fbclid>"), hanya ada bila pembeli tiba lewat '
  'klik iklan Meta. Menyambungkan Purchase ke iklan yang diklik. NULL = bukan dari iklan — normal.';
