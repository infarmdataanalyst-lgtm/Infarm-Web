-- supabase/migrations/20260909130000_shipment_status_cancelled.sql
-- Memperluas nilai yang boleh diisi `orders.shipment_status` dengan dua keadaan baru:
-- CANCELLED (penjemputan berhasil dihapus di Mengantar) dan CANCEL_FAILED (pesanan sudah
-- dibatalkan tapi penghapusannya gagal — PERLU DIHAPUS MANUAL oleh admin).
--
-- ── Kenapa perlu ──
-- Sampai sekarang membatalkan pesanan di OMS tidak menyentuh Mengantar sama sekali. Setelah
-- DELETE /order tersambung ke alur pembatalan, hasilnya harus tercatat — dan constraint yang
-- terpasang sejak 20260820130000 hanya mengizinkan ('BOOKED', 'FAILED'):
--
--   check (shipment_status is null or shipment_status in ('BOOKED', 'FAILED'))
--
-- Tanpa migration ini, penulisan 'CANCELLED' DITOLAK database (SQLSTATE 23514) tepat saat admin
-- menekan Batalkan untuk pertama kalinya. Kegagalannya lolos typecheck dan lint karena constraint
-- hidup di database, bukan di kode.
--
-- ── Kenapa BUKAN sekadar memakai 'FAILED' ──
-- 'FAILED' sudah punya arti yang mapan: booking gagal, pembayaran sudah masuk, PERLU DIBOOKING
-- ULANG. Kegagalan pembatalan menuntut tindakan yang BERLAWANAN: hapus penjemputannya. Menaruh
-- keduanya di satu nilai membuat indeks orders_shipment_failed_idx — yang memang dipakai untuk
-- mendaftarkan pesanan yang perlu ditindaklanjuti — mencampur dua masalah yang obatnya berkebalikan,
-- dan admin harus membuka satu per satu untuk tahu mana yang mana.
--
-- ── Kenapa CANCELLED perlu dicatat, bukan cukup mengandalkan jawaban Mengantar ──
-- Terukur 2026-09-09 di sandbox: DELETE /order membalas `{"success":false,"message":"Orders already
-- deleted"}` untuk DUA keadaan yang artinya berlawanan — `_id` karangan yang tak pernah ada, DAN
-- `_id` yang barusan berhasil dihapus. Mengantar tidak membedakan keduanya.
--
-- Akibatnya percobaan ulang (admin klik dua kali, atau jaringan putus sebelum jawaban sampai) tak
-- bisa ditafsirkan dari jawaban Mengantar saja: "sudah beres, lanjutkan" dan "id salah, perlu
-- tindakan manual" terlihat identik. Satu-satunya jalan keluar adalah MENCATAT SENDIRI bahwa
-- penghapusan sudah berhasil, lalu melewati panggilan berikutnya berdasarkan catatan itu.
-- Kolom inilah catatan tersebut.

-- Constraint lama dilepas dulu; `add constraint` tidak menimpa yang sudah ada.
alter table public.orders
  drop constraint if exists orders_shipment_status_check;

alter table public.orders
  add constraint orders_shipment_status_check
  check (
    shipment_status is null
    or shipment_status in ('BOOKED', 'FAILED', 'CANCELLED', 'CANCEL_FAILED')
  );

comment on column public.orders.shipment_status is
  'Status pengiriman Mengantar. NULL = booking belum pernah dicoba; '
  'BOOKED = resi terbit; '
  'FAILED = booking gagal dan PERLU DIBOOKING ULANG (pembayaran sudah masuk); '
  'CANCELLED = penjemputan berhasil dihapus di Mengantar (ongkir kembali ke saldo); '
  'CANCEL_FAILED = pesanan sudah dibatalkan tapi penghapusan penjemputan GAGAL — '
  'PERLU DIHAPUS MANUAL di dashboard Mengantar, kalau tidak kurir tetap datang menjemput.';

-- Daftar kerja admin untuk kegagalan pembatalan. Sengaja indeks TERPISAH dari
-- orders_shipment_failed_idx, mengikuti alasan pemisahan nilainya di atas: dua daftar berbeda
-- untuk dua tindakan yang berbeda, bukan satu daftar campuran yang harus disortir manual.
create index if not exists orders_shipment_cancel_failed_idx
  on public.orders (created_at desc)
  where shipment_status = 'CANCEL_FAILED';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260909130000_shipment_status_cancelled', 'shipment_status menerima CANCELLED & CANCEL_FAILED')
--     on conflict (version) do nothing;
--
-- CATATAN: per 2026-09-09 ledger baru memuat 7 dari 35 migration. Yang bolong adalah CATATANNYA,
-- bukan perubahannya — sebagian besar migration itu sudah jalan (kolomnya terbukti ada di database).
-- Melengkapi ledger dilacak terpisah; jangan mengisinya dengan tebakan.
