-- 20260924120000_orders_ga_session_id.sql
-- Menyimpan session_id Google Analytics 4 milik pembeli pada pesanannya.
--
-- ── Kenapa `ga_client_id` (20260923120000) saja tidak cukup ──
-- `client_id` menjawab "SIAPA yang membeli" — browser mana. Itu sudah membuat event `purchase`
-- dari webhook menempel ke pengunjung yang benar.
--
-- Yang tidak dijawabnya: "dari KUNJUNGAN YANG MANA". Informasi sumber trafik (Direct, Referral,
-- Organic Search, kampanye) melekat pada SESI, bukan pada pengguna. Tanpa session_id, GA4
-- menerima penjualannya tapi tak bisa menempelkannya ke kanal mana pun.
--
-- Terbukti di produksi 24 Sep 2026: laporan Akuisisi traffic menampilkan seluruh Rp83.888 dari
-- INV-20260923-R60NTSBP di baris **Unassigned**, sementara Direct/Referral/Organic Search
-- semuanya Rp0. Artinya pertanyaan "kanal mana yang menghasilkan uang" — satu-satunya yang GA4
-- jawab lebih baik daripada database sendiri — TIDAK bisa dijawab sama sekali.
--
-- ── Kenapa penempelannya bisa diandalkan di sini ──
-- Tagihan Xendit berlaku 24 jam (`INVOICE_DURATION_SECONDS`, src/lib/xendit/invoice.ts:61), jadi
-- tak ada pembayaran yang lunas berhari-hari setelah sesinya. Jarak terjauh antara sesi dan event
-- purchase adalah satu hari — masih dalam jangkauan GA4 menggabungkan keduanya.
--
-- ── Bentuk nilainya ──
-- Angka bulat (stempel waktu unix detik) hasil parsing cookie `_ga_<measurement-id>`. Bentuk
-- cookie itu TIDAK didokumentasikan Google dan sudah berganti sekali (GS1 → GS2), jadi parsernya
-- memperlakukan bentuk tak dikenal sebagai "tidak ada session_id" dan pesanan tetap tersimpan.
--
-- NULLABLE dan tanpa default, alasan sama dengan ga_client_id: pembeli yang memblokir GA, mode
-- privat, klien versi lama, atau bentuk cookie yang berubah — semuanya sah, hanya kehilangan
-- atribusi sesi.

alter table public.orders
  add column if not exists ga_session_id text;

comment on column public.orders.ga_session_id is
  'session_id GA4 pembeli (dari cookie _ga_<measurement-id>, berupa stempel waktu unix). Dikirim '
  'webhook Xendit bersama ga_client_id supaya event purchase menempel ke SESI yang benar, bukan '
  'jatuh ke Unassigned. NULL = tak terbaca (GA diblokir, mode privat, bentuk cookie berubah) atau '
  'pesanan dibuat sebelum migration ini — bukan kesalahan.';
