-- supabase/migrations/20260910120000_orders_invoice_expire.sql
-- Mencatat hasil upaya MEMATIKAN tagihan Xendit saat pesanan dibatalkan.
--
-- ── Masalah yang ditutup ──
-- Membatalkan pesanan TIDAK mematikan tagihan Xendit-nya. Tautan pembayarannya tetap hidup sampai
-- kedaluwarsa sendiri (INVOICE_DURATION_SECONDS = 24 jam). Selama jendela itu pembeli masih bisa
-- membayar pesanan yang sudah batal — mis. dari email tagihan lama atau tab yang belum ditutup.
--
-- Yang terjadi bila itu berlangsung:
--   1. webhook MENOLAK menghidupkan pesanannya kembali (benar, sudah tertangani)
--   2. uangnya tetap masuk ke saldo Xendit kita
--   3. pembeli tidak menerima apa pun
--   4. satu-satunya jejaknya adalah console.error yang tak pernah dibaca siapa pun
--
-- ── Kenapa ini lebih mendesak daripada refund ──
-- Terverifikasi 2026-09-10 dari help center Xendit: pembayaran lewat Virtual Account / transfer
-- bank TIDAK BISA di-refund Xendit sama sekali — tidak lewat API, tidak lewat dashboard. Uang yang
-- terlanjur masuk hanya bisa dikembalikan lewat transfer BARU (disbursement) ke rekening pembeli,
-- yang menuntut nomor rekening — data yang tidak pernah kita kumpulkan — dan menanggung biaya
-- tersendiri.
--
-- Jadi uang yang masuk untuk pesanan yang sudah batal MAHAL untuk dikembalikan. Mencegahnya cukup
-- satu panggilan POST /invoices/{id}/expire, memakai Invoice ID yang SUDAH tersimpan di
-- orders.id_transaksi. Tak ada migration identitas, tak ada backfill, tak ada uang yang berpindah.
--
-- ── Kenapa kolom, bukan cukup log ──
-- Alasan yang sama seperti CANCEL_FAILED pada migration 20260909130000: kegagalan yang hanya hidup
-- di log server adalah kegagalan yang tidak ada. Kalau Xendit sedang mati saat pembatalan, tagihan
-- itu TETAP hidup dan tetap bisa dibayar — dan tak seorang pun akan tahu sampai uangnya masuk.
-- Kolom ini yang membuat keadaan tersebut bisa didaftar dan ditindaklanjuti.

alter table public.orders
  add column if not exists invoice_expired_at   timestamptz,
  add column if not exists invoice_expire_error text;

comment on column public.orders.invoice_expired_at is
  'Kapan tagihan Xendit BERHASIL dimatikan lewat POST /invoices/{id}/expire saat pesanan '
  'dibatalkan. NULL = belum pernah berhasil (belum dicoba, tak perlu dicoba karena sudah dibayar, '
  'atau percobaannya gagal — lihat invoice_expire_error).';

comment on column public.orders.invoice_expire_error is
  'Alasan kegagalan mematikan tagihan Xendit. Terisi berarti PESANAN SUDAH DIBATALKAN TAPI '
  'TAGIHANNYA MASIH HIDUP dan masih bisa dibayar pembeli. Uang yang terlanjur masuk lewat VA tak '
  'bisa di-refund Xendit, jadi baris seperti ini WAJIB ditindaklanjuti: matikan tagihannya manual '
  'di dashboard Xendit. Dikosongkan bila percobaan berikutnya berhasil.';

-- Daftar kerja admin. Partial index, mengikuti pola orders_shipment_failed_idx: yang dicari selalu
-- baris yang BERMASALAH, dan jumlahnya seharusnya nol pada hari yang normal.
create index if not exists orders_invoice_expire_failed_idx
  on public.orders (created_at desc)
  where invoice_expire_error is not null;

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260910120000_orders_invoice_expire', 'kolom hasil mematikan tagihan Xendit saat pembatalan')
--     on conflict (version) do nothing;
