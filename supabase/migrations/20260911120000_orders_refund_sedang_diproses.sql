-- supabase/migrations/20260911120000_orders_refund_sedang_diproses.sql
-- Menambah keadaan SEDANG_DIPROSES pada `orders.refund_status`.
--
-- ── Masalah yang ditutup ──
-- Pengembalian dana e-wallet punya DUA endpoint dengan sifat waktu yang berbeda:
--
--   POST /ewallets/charges/{id}/void      hari yang sama · selesai hampir seketika
--   POST /ewallets/charges/{id}/refunds   H+1 dan seterusnya · ASINKRON, ~1 hari kerja
--
-- Yang kedua menjawab `PENDING` lebih dulu; hasil sesungguhnya (SUCCEEDED / FAILED) baru dikirim
-- belakangan lewat callback `refund.succeeded` / `refund.failed`.
--
-- Versi pertama (migration 20260910130000) tidak memperhitungkan itu: begitu Xendit menjawab ok,
-- barisnya langsung ditulis SUDAH_REFUND dan keluar dari daftar kerja. Untuk `void` benar. Untuk
-- `refunds` SALAH — kita menyatakan dana sudah kembali padahal masih diproses, dan bila kemudian
-- GAGAL tak seorang pun akan tahu, karena barisnya sudah tak ada di daftar mana pun.
--
-- ── Kenapa keadaan ketiga, bukan sekadar dibiarkan PERLU_REFUND ──
-- Membiarkannya PERLU_REFUND memang membuatnya tetap terlihat, tapi tetap terlihat sebagai
-- PEKERJAAN YANG BELUM DIKERJAKAN. Admin berikutnya akan menekan tombolnya lagi, dan dana terkirim
-- dua kali. Keadaan ini justru harus berkata: sudah dikirim, jangan diulang, tapi belum dipastikan.
--
-- Alur lengkapnya:
--   PERLU_REFUND ──tombol ditekan──> SEDANG_DIPROSES ──callback SUCCEEDED──> SUDAH_REFUND
--                                          │
--                                          └──callback FAILED──> PERLU_REFUND (muncul lagi)
--
-- `void` melompati SEDANG_DIPROSES karena hasilnya sudah pasti saat respons diterima.

alter table public.orders
  drop constraint if exists orders_refund_status_check;

alter table public.orders
  add constraint orders_refund_status_check
  check (
    refund_status is null
    or refund_status in ('PERLU_REFUND', 'SEDANG_DIPROSES', 'SUDAH_REFUND', 'TIDAK_PERLU')
  );

comment on column public.orders.refund_status is
  'Keadaan pengembalian dana. NULL = tak pernah relevan (belum dibayar / tak dibatalkan); '
  'PERLU_REFUND = pesanan LUNAS yang dibatalkan, uang pembeli masih di kita — WAJIB dikembalikan; '
  'SEDANG_DIPROSES = sudah dikirim ke Xendit tapi hasilnya belum dipastikan (refunds asinkron, '
  'menunggu callback refund.succeeded/refund.failed) — JANGAN diulang; '
  'SUDAH_REFUND = terkonfirmasi kembali ke pembeli; '
  'TIDAK_PERLU = admin memutuskan tak ada yang perlu dikembalikan (mis. pembeli memilih voucher).';

-- Daftar kerja "menunggu kepastian". Terpisah dari orders_perlu_refund_idx karena tindakannya
-- berbeda: yang satu menuntut admin MENGIRIM uang, yang satu menuntut admin MENUNGGU — dan baris
-- yang menggantung terlalu lama di sini berarti callback-nya tak pernah sampai.
create index if not exists orders_refund_diproses_idx
  on public.orders (created_at desc)
  where refund_status = 'SEDANG_DIPROSES';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260911120000_orders_refund_sedang_diproses', 'keadaan SEDANG_DIPROSES untuk refund asinkron')
--     on conflict (version) do nothing;
