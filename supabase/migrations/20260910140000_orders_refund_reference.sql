-- supabase/migrations/20260910140000_orders_refund_reference.sql
-- Nomor referensi pengembalian dana dari Xendit, untuk pengembalian yang dijalankan SISTEM.
--
-- ── Kenapa tidak menumpang refund_note ──
-- `refund_note` adalah tulisan ADMIN: rekening tujuan, nomor referensi transfer manual, atau alasan
-- mengapa tak ada yang perlu dikembalikan. Isinya bebas dan tak bisa dicari secara andal.
--
-- Kolom ini sebaliknya: nilai yang DIBERIKAN XENDIT saat pengembalian otomatis berhasil
-- (mis. id refund/void dari POST /ewallets/charges/{id}/refunds). Ia dipakai saat merekonsiliasi
-- mutasi Xendit dengan pesanan kita — pekerjaan yang menuntut pencocokan tepat, bukan membaca
-- kalimat. Mencampur keduanya berarti setiap rekonsiliasi harus mengurai teks bebas yang ditulis
-- orang berbeda dengan gaya berbeda.
--
-- NULL berarti pengembaliannya dijalankan MANUSIA (transfer manual atau lewat dashboard), bukan
-- sistem — dan itu keadaan yang akan tetap umum, karena pembayaran lewat transfer bank tak bisa
-- di-refund Xendit sama sekali.

alter table public.orders
  add column if not exists refund_reference text;

comment on column public.orders.refund_reference is
  'Nomor referensi pengembalian dana dari Xendit, diisi SISTEM saat pengembalian otomatis berhasil '
  '(id refund/void eWallet). NULL = dikembalikan manual oleh manusia. Dipakai untuk mencocokkan '
  'mutasi Xendit dengan pesanan; catatan bebas admin ada di refund_note.';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260910140000_orders_refund_reference', 'kolom referensi pengembalian dana otomatis Xendit')
--     on conflict (version) do nothing;
