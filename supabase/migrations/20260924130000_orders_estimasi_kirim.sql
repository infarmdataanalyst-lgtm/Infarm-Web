-- 20260924130000_orders_estimasi_kirim.sql
-- Menyimpan estimasi lama pengiriman dari Mengantar pada pesanannya.
--
-- ── Kenapa perlu kolom, bukan cukup dihitung di halaman ──
-- Sampai 24 Sep 2026 halaman sukses checkout MENGARANG estimasi tiba: tanggal pesanan +2 s/d +4
-- hari, sama untuk semua tujuan. Pembeli di Jakarta dan di Aceh melihat janji yang sama.
--
-- Angka yang sebenarnya sudah diberikan Mengantar saat cek ongkir (`estimatedDate` pada
-- allEstimatePublic, mis. "2-4 hari") dan sudah tampil di baris kurir checkout. Tapi nilai itu
-- hanya hidup di browser dan di cache server selama 10 menit. Begitu pembeli pindah ke halaman
-- sukses — apalagi membukanya lagi besok lewat tautan — tak ada yang tersisa untuk dibaca.
--
-- Menanyakan ulang ke Mengantar saat halaman sukses dibuka juga bukan jalan keluar: estimasinya
-- bergantung pada rute & kurir SAAT pembeli memilih, dan bisa berubah kemudian. Yang harus
-- ditampilkan adalah janji yang DILIHAT pembeli ketika ia menekan bayar. Satu-satunya cara
-- menjaganya adalah menyimpannya bersama pesanan, sama seperti ongkos_kirim.
--
-- ── Bentuk nilainya ──
-- Teks mentah dari Mengantar apa adanya ("2-4 hari", "1 hari", …). Sengaja TIDAK diurai menjadi
-- dua kolom angka di sini: bentuknya tak didokumentasikan dengan ketat, dan penguraian ada di
-- satu fungsi (src/lib/delivery-estimate.ts) yang bisa diperbaiki tanpa migration. Teks yang
-- tak terurai tetap tersimpan sebagai bukti apa yang dijanjikan.
--
-- NULLABLE dan tanpa default: pesanan sebelum migration ini, dan pesanan yang tarifnya tak membawa
-- estimasi, jatuh ke perkiraan lama (2–4 hari) di halaman sukses. Bukan kesalahan.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

alter table public.orders
  add column if not exists estimasi_kirim text;

comment on column public.orders.estimasi_kirim is
  'Estimasi lama pengiriman dari Mengantar (estimatedDate allEstimatePublic, mis. "2-4 hari") '
  'untuk kurir & gudang yang benar-benar memenuhi pesanan, disimpan saat pesanan dibuat. Dibaca '
  'halaman sukses checkout. NULL = pesanan lama atau tarif tanpa estimasi → perkiraan 2–4 hari.';

-- Verifikasi sesudah menjalankan:
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'orders' and column_name = 'estimasi_kirim';
--   -> satu baris, is_nullable = YES
