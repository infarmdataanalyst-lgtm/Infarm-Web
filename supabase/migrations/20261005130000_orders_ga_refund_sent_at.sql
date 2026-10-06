-- supabase/migrations/20261005130000_orders_ga_refund_sent_at.sql
-- Menambahkan `orders.ga_refund_sent_at`: kapan event GA4 `refund` untuk pesanan ini dikirim.
--
-- ── Kenapa perlu ──
-- Event `purchase` dikirim ke GA4 saat pesanan Lunas, tapi pesanan yang kemudian dibatalkan dan
-- di-refund tak pernah dilaporkan balik. Revenue di GA4 dan dashboard Looker Studio jadi lebih
-- tinggi daripada kenyataan. Sejak 2026-10-05 event `refund` dikirim saat refund_status berpindah
-- ke SUDAH_REFUND (src/lib/ga-refund.ts).
--
-- Kolom ini punya dua tugas:
--   1. Penjaga "satu event per pesanan": sebelum mengirim, server menjalankan
--        UPDATE ... SET ga_refund_sent_at = now()
--        WHERE nomor_invoice = ? AND refund_status = 'SUDAH_REFUND' AND ga_refund_sent_at IS NULL
--      Hanya satu pemanggil yang menang, apa pun jalurnya (callback Xendit, tombol OMS, catat manual).
--   2. Daftar susulan: refund_status = 'SUDAH_REFUND' AND ga_refund_sent_at IS NULL = pesanan yang
--      refund-nya BELUM sampai ke GA4 (pesanan sebelum fitur ini, atau pengiriman yang ditolak GA4).
--
-- NULL tetap normal untuk pesanan tanpa ga_client_id — purchase-nya pun tak pernah terkirim, jadi
-- refund-nya memang sengaja tak dilaporkan. Saring dengan ga_client_id IS NOT NULL saat menyusulkan.
--
-- ── Kalau migration ini belum dijalankan ──
-- Klaim gagal dengan kolom tak dikenal; kode mencatatnya di log lalu TETAP mengirim event (lapis
-- compare-and-swap pada refund_status masih menjaga satu event per pesanan). Tak ada refund yang
-- tertahan.

alter table public.orders
  add column if not exists ga_refund_sent_at timestamptz;

comment on column public.orders.ga_refund_sent_at is
  'Kapan event GA4 `refund` pesanan ini dikirim lewat Measurement Protocol. NULL = belum pernah '
  '(pesanan belum di-refund, tanpa ga_client_id, dari sebelum 2026-10-05, atau pengiriman ditolak '
  'GA4). Diisi lewat compare-and-swap sebelum mengirim — penjaga satu event per pesanan.';

-- Daftar susulan: refund yang sudah selesai tapi belum dilaporkan ke GA4. Parsial, jadi kecil.
create index if not exists orders_ga_refund_pending_idx
  on public.orders (refund_at desc)
  where refund_status = 'SUDAH_REFUND' and ga_refund_sent_at is null;

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20261005130000_orders_ga_refund_sent_at', 'orders.ga_refund_sent_at untuk event GA4 refund')
--     on conflict (version) do nothing;
