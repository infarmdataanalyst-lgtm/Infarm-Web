-- supabase/migrations/20260904120100_aktifkan_rls_order_items.sql
-- MENGAKTIFKAN RLS pada public.order_items (menutup SEC-017).
--
-- ⚠ INI BUKAN PENCEGAHAN — INI PERBAIKAN ATAS KEADAAN YANG SUDAH TERBUKTI TERBUKA.
--
-- Temuan SEC-017 dulu berbunyi "status RLS tidak terverifikasi". Pada 2026-09-04 statusnya
-- akhirnya diuji langsung ke project ini memakai ANON KEY — kunci yang memang ikut terkirim ke
-- setiap browser pengunjung — dan hasilnya:
--
--   GET    /rest/v1/order_items  → 200, SELURUH 75 baris terbaca
--   POST   /rest/v1/order_items  → 409 pelanggaran foreign key, BUKAN penolakan izin
--                                   (artinya: insert-nya diizinkan, yang menolak cuma FK)
--   PATCH  /rest/v1/order_items  → 200
--   DELETE /rest/v1/order_items  → 200
--
-- Jadi RLS memang TIDAK PERNAH aktif di tabel ini: ia dibuat manual lewat Dashboard di luar
-- riwayat migration, sehingga baris `alter table ... enable row level security` di
-- 20260622100100_init_order_items.sql tak pernah benar-benar dijalankan di project ini.
--
-- Yang terbuka: isi belanjaan SETIAP pesanan (product_id, quantity, price_at_purchase) beserta
-- order_id yang menautkannya ke tabel orders. Dan karena penulisan pun tak terhalang, isi pesanan
-- orang lain bisa DIUBAH — jumlah, harga satuan, bahkan baris tambahan pada pesanan yang sudah
-- ada. Bandingkan dengan tabel orders di project yang sama: anon menerima [] kosong di sana, jadi
-- lapisannya memang bekerja — order_items saja yang terlewat.
--
-- Sesudah SQL ini dijalankan, ulangi pengujian di atas; keempatnya harus berubah menjadi tak
-- mengembalikan baris apa pun. Aplikasi TIDAK terpengaruh: seluruh akses order_items memakai
-- createAdminClient() (service_role), yang menembus RLS.

-- === 1. Aktifkan RLS ===
alter table public.order_items enable row level security;

-- Ikut memaksa pemilik tabel tunduk pada policy. Tanpa ini, peran pemilik (mis. postgres saat
-- menjalankan skrip lewat Dashboard) tetap melewati RLS begitu saja.
alter table public.order_items force row level security;

-- === 2. Cabut hak akses Data API untuk anon/authenticated ===
-- RLS tanpa policy sudah cukup untuk menolak, tapi grant yang menganggur tetap dicabut: pertahanan
-- berlapis, dan supaya tabel ini tak ikut terbuka lagi bila suatu saat ada yang menambahkan policy
-- permisif tanpa sadar.
--
-- SENGAJA TIDAK ADA POLICY publik yang dibuat. order_items berisi data pesanan; seluruh akses
-- aplikasi lewat service_role di server, jadi tak ada satu pun kebutuhan sah dari browser.
revoke all on public.order_items from anon, authenticated;

-- === 3. Jangan sampai terulang ===
-- Matikan juga opsi "auto-expose new tables" di Dashboard → Settings → API. Tanpa itu, tabel
-- berikutnya yang dibuat manual lewat Dashboard akan lahir terbuka dengan cara yang sama persis.
