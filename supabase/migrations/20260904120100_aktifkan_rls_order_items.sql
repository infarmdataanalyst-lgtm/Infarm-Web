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
-- Diuji ulang 2026-09-14, masih terbuka: HEAD dengan anon key membalas 200, Content-Range 0-81/82.
-- Barisnya bertambah seiring pesanan baru — paparannya tumbuh, bukan diam.
--
-- Jadi RLS memang TIDAK PERNAH aktif di tabel ini: ia dibuat manual lewat Dashboard di luar
-- riwayat migration, sehingga baris `alter table ... enable row level security` di
-- 20260622100100_init_order_items.sql tak pernah benar-benar dijalankan di project ini.
--
-- Yang terbuka: isi belanjaan SETIAP pesanan (product_id, quantity, price_at_purchase) beserta
-- order_id yang menautkannya ke tabel orders. Dan karena penulisan pun tak terhalang, isi pesanan
-- orang lain bisa DIUBAH — jumlah, harga satuan, bahkan baris tambahan pada pesanan yang sudah
-- ada. Bandingkan dengan tabel orders di project yang sama: anon menerima kosong di sana, jadi
-- lapisannya memang bekerja — order_items saja yang terlewat. Sapuan 2026-09-14 atas 15 tabel
-- dengan anon key menegaskan: HANYA order_items yang membocorkan baris.
--
-- Dampak ke aplikasi: tidak ada. Seluruh BACAAN order_items memakai createAdminClient()
-- (service_role, BYPASSRLS), dan satu-satunya PENULISAN adalah fungsi create_order_with_items
-- yang dipanggil lewat service_role pula.

-- === 1. Aktifkan RLS ===
alter table public.order_items enable row level security;

-- ── Kenapa TIDAK memakai `force row level security` ──
-- Versi pertama berkas ini memuatnya. Dihapus 2026-09-14 sebelum pernah dijalankan, karena ia
-- berisiko MEMATIKAN CHECKOUT dan tak menambah perlindungan apa pun terhadap ancaman yang
-- sebenarnya.
--
-- `force` membuat PEMILIK tabel ikut tunduk pada RLS. create_order_with_items adalah fungsi
-- `security definer` — ia menulis ke order_items dengan hak PEMILIK fungsinya, bukan pemanggilnya.
-- Tabel ini sengaja TANPA policy, jadi di bawah `force`, pemilik yang tak punya atribut BYPASSRLS
-- akan ditolak setiap kali menyisipkan baris: setiap pesanan gagal dibuat.
--
-- Sementara itu ancaman yang ditutup SEC-017 adalah anon/authenticated lewat Data API, dan
-- keduanya sudah tertutup penuh oleh `enable` di atas ditambah `revoke` di bawah. `force` hanya
-- menjaga dari pemilik tabel sendiri — bukan penyerang di skenario ini.

-- === 2. Cabut hak akses Data API untuk anon/authenticated ===
-- RLS tanpa policy sudah cukup untuk menolak, tapi grant yang menganggur tetap dicabut: pertahanan
-- berlapis, dan supaya tabel ini tak ikut terbuka lagi bila suatu saat ada yang menambahkan policy
-- permisif tanpa sadar.
--
-- SENGAJA TIDAK ADA POLICY publik yang dibuat. order_items berisi data pesanan; seluruh akses
-- aplikasi lewat service_role di server, jadi tak ada satu pun kebutuhan sah dari browser.
revoke all on public.order_items from anon, authenticated;

-- === 3. Catat di ledger (SEC-036) ===
insert into public.schema_migrations (version, note)
values ('20260904120100_aktifkan_rls_order_items', 'dijalankan manual')
on conflict (version) do nothing;

-- === 4. Jangan sampai terulang ===
-- Matikan juga opsi "auto-expose new tables" di Dashboard → Settings → API. Tanpa itu, tabel
-- berikutnya yang dibuat manual lewat Dashboard akan lahir terbuka dengan cara yang sama persis.

-- === Verifikasi sesudah dijalankan ===
--   select relrowsecurity from pg_class where oid = 'public.order_items'::regclass;  -- harus true
-- Lalu uji dengan anon key: GET/HEAD /rest/v1/order_items harus tak lagi mengembalikan baris, dan
-- satu checkout sungguhan harus tetap berhasil (membuktikan jalur create_order_with_items utuh).
