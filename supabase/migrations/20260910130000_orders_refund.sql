-- supabase/migrations/20260910130000_orders_refund.sql
-- Melacak pengembalian dana pesanan yang dibatalkan setelah dibayar.
--
-- ── Masalah yang ditutup ──
-- Membatalkan pesanan yang sudah LUNAS tidak mengubah `status_pembayaran`. Barisnya menjadi:
--
--     order_status       CANCELLED
--     status_pembayaran  PAID      <- tidak ikut berubah
--
-- Itulah SATU-SATUNYA tanda bahwa kita masih memegang uang orang. Tidak ada daftar yang
-- menampilkannya, tidak ada penanda, tidak ada notifikasi. Dua admin bisa mentransfer dua kali
-- untuk pesanan yang sama dan tak seorang pun akan tahu, karena tak ada tempat mencatat bahwa
-- yang pertama sudah dilakukan.
--
-- ── Kenapa pencatatannya tak bisa ditunda sampai refund otomatis ──
-- Terverifikasi 2026-09-10, dan ini yang membuat pencatatan jadi wajib lebih dulu:
--
--   Transfer bank / VA  -> TIDAK BISA di-refund Xendit sama sekali. Pengembaliannya adalah
--                          TRANSFER MANUAL ke rekening pembeli, dijalankan manusia dari dashboard.
--                          Tak ada sistem yang tahu itu sudah terjadi kecuali manusia mencatatnya.
--   E-wallet            -> bisa otomatis lewat eWallets API, tapi belum dibangun.
--
-- Jadi untuk sebagian pesanan, pencatatan manual BUKAN solusi sementara — ia satu-satunya
-- mekanisme yang akan pernah ada.
--
-- ── Kenapa jumlahnya dicatat terpisah dari jumlah_total ──
-- Biaya transfer boleh dipotong dari pengembalian (keputusan pemilik proyek 2026-09-10), jadi yang
-- benar-benar diterima pembeli bisa lebih kecil dari nilai pesanan. Menyimpulkannya dari
-- `jumlah_total` akan salah, dan selisihnya persis yang ditanyakan pembeli saat protes.
--
-- ── Kenapa BUKAN memakai status_pembayaran ──
-- Kolom itu menjawab "apakah pembeli sudah membayar" — pertanyaan yang jawabannya tetap YA meski
-- uangnya sudah dikembalikan. Menimpanya dengan 'REFUNDED' akan menghapus fakta bahwa pembayaran
-- pernah terjadi, dan itu fakta yang dibutuhkan rekonsiliasi maupun laporan penjualan.

alter table public.orders
  add column if not exists refund_status text,
  add column if not exists refund_amount integer,
  add column if not exists refund_note   text,
  add column if not exists refund_at     timestamptz,
  add column if not exists refund_by     text;

-- NULL sengaja SAH dan bermakna: "pesanan ini tak pernah butuh pengembalian dana" — pesanan yang
-- belum dibayar, atau yang tak pernah dibatalkan. Hanya pesanan LUNAS + DIBATALKAN yang ditandai.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_refund_status_check'
  ) then
    alter table public.orders
      add constraint orders_refund_status_check
      check (refund_status is null or refund_status in ('PERLU_REFUND', 'SUDAH_REFUND', 'TIDAK_PERLU'));
  end if;
end $$;

comment on column public.orders.refund_status is
  'Keadaan pengembalian dana. NULL = tak pernah relevan (belum dibayar / tak dibatalkan); '
  'PERLU_REFUND = pesanan LUNAS yang dibatalkan, uang pembeli masih di kita — WAJIB dikembalikan; '
  'SUDAH_REFUND = sudah dikembalikan, lihat refund_at/refund_by/refund_note; '
  'TIDAK_PERLU = admin memutuskan tak ada yang perlu dikembalikan (mis. pembeli memilih voucher).';

comment on column public.orders.refund_amount is
  'Rupiah yang BENAR-BENAR dikembalikan ke pembeli. Bisa lebih kecil dari jumlah_total bila biaya '
  'transfer dipotong. Jangan disimpulkan dari jumlah_total.';

comment on column public.orders.refund_note is
  'Catatan bebas: bank & nomor rekening tujuan, nomor referensi transfer, atau alasan bila '
  'TIDAK_PERLU. Inilah bukti yang dicari saat pembeli menanyakan dananya.';

comment on column public.orders.refund_at is
  'Kapan pengembalian dana selesai dijalankan.';

comment on column public.orders.refund_by is
  'Nama admin yang menjalankan pengembalian dana. Sengaja teks, bukan foreign key ke admin_users: '
  'menghapus akun admin tak boleh menghapus jejak siapa yang mengirim uang.';

-- Daftar kerja. Partial index, pola yang sama dengan orders_shipment_failed_idx dan
-- orders_invoice_expire_failed_idx: yang dicari selalu baris yang MENUNGGU TINDAKAN.
create index if not exists orders_perlu_refund_idx
  on public.orders (created_at desc)
  where refund_status = 'PERLU_REFUND';

-- === Menandai pesanan LAMA yang sudah terlanjur dibatalkan dalam keadaan lunas ===
--
-- Tanpa ini, daftar kerja hanya memuat pembatalan yang terjadi SETELAH migration dijalankan, dan
-- pesanan yang sudah menunggu sejak sebelumnya tetap tak terlihat — persis yang ingin ditutup.
update public.orders
   set refund_status = 'PERLU_REFUND'
 where order_status = 'CANCELLED'
   and status_pembayaran = 'PAID'
   and refund_status is null;

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260910130000_orders_refund', 'kolom & daftar kerja pengembalian dana pesanan dibatalkan')
--     on conflict (version) do nothing;
