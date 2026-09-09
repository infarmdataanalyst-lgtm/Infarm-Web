-- supabase/migrations/20260909120000_orders_mengantar_ids.sql
-- Menyimpan nomor identitas pengiriman MILIK MENGANTAR pada pesanan, supaya penjemputan yang
-- sudah dibooking bisa DIBATALKAN dari sisi kita saat pembatalan pesanan disetujui admin.
--
-- ── Masalah yang ditutup ──
-- Satu pengiriman punya TIGA nomor di Mengantar, dan selama ini kita hanya menyimpan satu:
--
--   cnote_no  "JO9789841154"              nomor resi — tercetak di label, dilihat pembeli   ✅ disimpan
--   ORDER_ID  "260130OVBBOO"              nomor pesanan di pembukuan Mengantar               ❌ dibuang
--   _id       "697c58034fa61abe7c700da9"  kunci basis data Mengantar                         ❌ dibuang
--
-- Endpoint pembatalan `DELETE {BASE}/api/public/{KEY}/order` menerima `ids` (_id) atau `orderIds`
-- (ORDER_ID). Ia TIDAK menerima nomor resi — satu-satunya nomor yang kita punya. Akibatnya
-- pembatalan penjemputan tak bisa dijalankan otomatis, dan docs/checkout-flow.md menyebutnya
-- "langkah yang tidak punya jaring pengaman": admin harus ingat membatalkan manual di dashboard
-- Mengantar, kalau lupa kurir tetap datang menjemput paket yang pembatalannya sudah disetujui.
--
-- Ketiganya SUDAH ADA di respons booking; kode kita membaca ORDER_ID lalu membuangnya begitu
-- fungsinya selesai (lihat shipment-booking.ts). Kolom-kolom ini menjadikannya permanen.
--
-- ── Kenapa MENYIMPAN, bukan menanyakan ulang tiap kali ──
-- `_id` bisa dicari ulang lewat `GET /order?tracking_id={resi}` — dan jalur itu memang tetap
-- dibutuhkan untuk 11 pesanan yang terlanjur dibooking sebelum kolom ini ada. Tapi menjadikannya
-- jalur UTAMA berarti setiap pembatalan bergantung pada Mengantar sedang hidup, tepat di saat kita
-- paling butuh cepat. Bila panggilan itu gagal, pesanan terlanjur dibatalkan di sistem kita
-- sementara penjemputannya tidak — persis keadaan yang seharusnya ditutup. Menyimpannya membuat
-- pembatalan berjalan dengan NOL panggilan pencarian.
--
-- ── Kenapa nullable, tanpa NOT NULL & tanpa default ──
-- Pesanan yang belum dibayar belum punya nomor-nomor ini, dan 12 pesanan lama tak akan pernah
-- punya sampai diisi lewat backfill. Kolom wajib akan menolak keduanya.

alter table public.orders
  add column if not exists mengantar_order_object_id text,
  add column if not exists mengantar_order_id        text,
  add column if not exists mengantar_batch_id        text;

comment on column public.orders.mengantar_order_object_id is
  'Mengantar `_id` (ObjectId 24 hex) pengiriman ini. Dikirim sebagai `ids` saat DELETE /order untuk membatalkan penjemputan. Diisi saat booking; untuk pesanan lama diisi lewat backfill dari nomor resi.';

comment on column public.orders.mengantar_order_id is
  'Mengantar `ORDER_ID` (mis. "260130OVBBOO") — nomor pesanan di pembukuan Mengantar. Alternatif `orderIds` pada DELETE /order bila _id tak tersedia. BUKAN nomor invoice kita dan BUKAN nomor resi.';

comment on column public.orders.mengantar_batch_id is
  'Mengantar `batch_id` pengiriman ini. Dipakai DELETE /batch bila kelak satu batch perlu dibatalkan sekaligus. Disimpan sekarang karena nilainya ada di respons booking dan tak bisa didapat lagi setelah itu.';

-- Indeks SENGAJA tidak dibuat. Ketiga kolom hanya DIBACA setelah baris pesanannya ditemukan lewat
-- nomor_invoice (yang sudah berindeks), tak pernah dipakai sebagai kriteria pencarian. Satu-satunya
-- pemindaian adalah backfill sekali-jalan atas belasan baris — indeks tak menolong apa pun di situ.

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260909120000_orders_mengantar_ids', 'kolom _id/ORDER_ID/batch_id Mengantar agar penjemputan bisa dibatalkan otomatis')
--     on conflict (version) do nothing;
--
-- CATATAN: tabel public.schema_migrations BELUM ADA (terverifikasi 2026-09-09, PGRST205). Jalankan
-- 20260907120100_ledger_migration.sql lebih dulu, lalu catat migration ini beserta yang tertinggal.
