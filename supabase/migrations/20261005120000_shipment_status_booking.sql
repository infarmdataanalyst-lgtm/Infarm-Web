-- supabase/migrations/20261005120000_shipment_status_booking.sql
-- Menambahkan nilai BOOKING ke `orders.shipment_status`: kunci sementara selama POST /order ke
-- Mengantar sedang berjalan (claimShipmentBooking di src/lib/mock-db/orders.ts).
--
-- ── Kenapa perlu ──
-- Sejak Payment Sessions (2026-09-30), satu pembayaran memicu DUA callback Xendit
-- (`payment_session.completed` dan `payment.capture`). Pada 2026-10-05 keduanya tiba 0,17 detik
-- berselisih untuk INV-20261005-YV2GX0NS, dan KEDUANYA membooking kurir — dua POST /order untuk
-- satu pesanan. Kali itu SPX menolak keduanya, jadi tak ada yang tertagih; untuk rute yang
-- dilayani, hasilnya dua resi dan saldo Mengantar terpotong dua kali.
--
-- Penjaga utamanya ada di kode (perpindahan ke Lunas kini compare-and-swap). Kunci ini lapis
-- kedua: UPDATE ... SET shipment_status = 'BOOKING' WHERE no_tracking IS NULL AND
-- (shipment_status IS NULL OR shipment_status = 'FAILED') — hanya satu pemicu yang menang.
--
-- ── Kalau migration ini belum dijalankan ──
-- Penulisan 'BOOKING' ditolak (SQLSTATE 23514). Kode menanganinya: dicatat keras di log, lalu
-- booking DILANJUTKAN tanpa kunci (lapis pertama tetap aktif). Tak ada pesanan yang tertahan.
--
-- ── Pesanan yang tertinggal di BOOKING ──
-- Terjadi hanya bila fungsi mati di tengah panggilan Mengantar. Pesanan seperti itu muncul di
-- daftar masalah OMS sebagai "Lunas tapi belum ada resi" (order-issues.ts), karena statusnya
-- bukan FAILED dan resinya kosong.

alter table public.orders
  drop constraint if exists orders_shipment_status_check;

alter table public.orders
  add constraint orders_shipment_status_check
  check (
    shipment_status is null
    or shipment_status in ('BOOKING', 'BOOKED', 'FAILED', 'CANCELLED', 'CANCEL_FAILED')
  );

comment on column public.orders.shipment_status is
  'Status pengiriman Mengantar. NULL = booking belum pernah dicoba; '
  'BOOKING = POST /order sedang berjalan (kunci anti booking ganda); '
  'BOOKED = resi terbit; '
  'FAILED = booking gagal dan PERLU DIBOOKING ULANG (pembayaran sudah masuk); '
  'CANCELLED = penjemputan berhasil dihapus di Mengantar (ongkir kembali ke saldo); '
  'CANCEL_FAILED = pesanan sudah dibatalkan tapi penghapusan penjemputan GAGAL — '
  'PERLU DIHAPUS MANUAL di dashboard Mengantar, kalau tidak kurir tetap datang menjemput.';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20261005120000_shipment_status_booking', 'shipment_status menerima BOOKING (kunci anti booking ganda)')
--     on conflict (version) do nothing;
