-- supabase/migrations/20260908120000_orders_invoice_reuse.sql
-- Menyimpan tautan & masa berlaku tagihan Xendit pada pesanan, supaya tagihan yang MASIH HIDUP
-- bisa dipakai ulang alih-alih menerbitkan yang baru setiap kali pembeli menekan "Bayar Sekarang".
--
-- ── Masalah yang ditutup (API-XND-027) ──
-- POST /api/payments/invoice selalu memanggil Xendit dan selalu menerbitkan tagihan BARU untuk
-- pesanan yang sama. Satu-satunya rem adalah pembatas laju 5 kali per 30 menit, jadi satu pesanan
-- bisa memiliki sampai lima tagihan hidup sekaligus. Akibatnya:
--   1. Pembeli bisa membuka tagihan lama (dari email/riwayat tab) dan membayar nominal yang sudah
--      tidak berlaku bila pesanannya sempat berubah.
--   2. Dashboard Xendit dipenuhi tagihan kembar untuk satu pesanan, sehingga rekonsiliasi manual
--      jadi menebak-nebak mana yang sebenarnya dibayar.
--   3. Tiap penerbitan adalah panggilan API berbayar yang sebetulnya tak perlu.
--
-- ── Kenapa kolom, bukan bertanya ke Xendit ──
-- Alternatifnya memanggil GET invoice ke Xendit tiap kali untuk memeriksa apakah tagihan lama
-- masih hidup. Menyimpannya di sini membuat pemakaian ulang berjalan TANPA satu pun panggilan
-- keluar: lebih cepat bagi pembeli, dan tetap bekerja saat Xendit sedang lambat atau tak terjangkau
-- — justru saat pembeli paling mungkin menekan tombol bayar berkali-kali.
--
-- Sengaja BUKAN kolom nomor VA/bank. Invoice Xendit adalah halaman pembayaran yang bisa memuat
-- banyak metode sekaligus, jadi "satu nomor VA per pesanan" bukan gambaran yang benar. Penyimpanan
-- rincian VA dilacak terpisah sebagai API-XND-010.

alter table public.orders
  add column if not exists invoice_url        text,
  add column if not exists invoice_expires_at timestamptz;

comment on column public.orders.invoice_url is
  'Tautan halaman pembayaran Xendit yang masih berlaku. Dipakai ulang selama invoice_expires_at belum lewat, agar satu pesanan tak menerbitkan tagihan berkali-kali (API-XND-027).';

comment on column public.orders.invoice_expires_at is
  'Kapan tagihan Xendit kedaluwarsa (expiry_date dari respons Xendit). Lewat tenggat ini, tagihan baru diterbitkan.';

-- Indeks TIDAK dibuat dengan sengaja: kedua kolom hanya dibaca lewat pencarian by nomor_invoice
-- yang sudah punya indeksnya sendiri, tak pernah sebagai kriteria pencarian.

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260908120000_orders_invoice_reuse', 'kolom invoice_url & invoice_expires_at untuk pemakaian ulang tagihan')
--     on conflict (version) do nothing;
