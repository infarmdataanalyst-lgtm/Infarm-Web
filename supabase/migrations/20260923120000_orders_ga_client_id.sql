-- 20260923120000_orders_ga_client_id.sql
-- Menyimpan client_id Google Analytics 4 milik pembeli pada pesanannya.
--
-- ── Kenapa kolom ini perlu ada sama sekali ──
-- Event `purchase` TIDAK bisa dikirim dari browser. Pembayaran di sini asinkron: pembeli pergi ke
-- halaman Xendit, dan VA/QRIS bisa dibayar berjam-jam kemudian — seringkali tanpa pernah kembali
-- ke /checkout/success. Event yang dipasang di halaman sukses akan melewatkan justru penjualan
-- yang paling lambat dibayar, dan menghitung ganda pembeli yang me-refresh halamannya.
--
-- Jadi `purchase` dikirim dari SERVER (webhook Xendit) lewat Measurement Protocol. Measurement
-- Protocol butuh client_id untuk tahu event ini milik siapa. Tanpa itu, setiap penjualan masuk
-- sebagai pengunjung baru dari (direct)/(none): jumlah uangnya benar, tapi pertanyaan "iklan/kanal
-- mana yang menghasilkan penjualan ini" — satu-satunya yang GA4 jawab lebih baik daripada
-- database kita sendiri — jadi mustahil dijawab.
--
-- ── Kenapa kolom terpisah, bukan lewat RPC create_order_with_items ──
-- Menambah parameter ke RPC berarti membuat overload baru, dan overload RPC di project ini sudah
-- punya riwayat panjang (lihat 20260922110000). Ini data analitik, bukan uang: ia tak perlu ikut
-- transaksi atomik pembuatan pesanan. Ditulis lewat UPDATE terpisah SETELAH pesanan tersimpan,
-- jadi kegagalannya paling buruk berarti satu pesanan kehilangan atribusi — bukan checkout gagal.
--
-- NULLABLE dan tanpa default: pesanan dari pembeli yang memblokir GA, dari perangkat tanpa cookie,
-- atau dari klien versi lama tetap sah. Kolom kosong = atribusi tak tersedia, bukan kesalahan.

alter table public.orders
  add column if not exists ga_client_id text;

comment on column public.orders.ga_client_id is
  'client_id GA4 pembeli (dari cookie _ga, bentuk "1234567890.1234567890"). Dipakai webhook Xendit '
  'untuk mengirim event purchase lewat Measurement Protocol. NULL = pembeli tak punya cookie GA '
  '(pemblokir iklan, mode privat) atau pesanan dibuat sebelum migration ini — bukan kesalahan.';
