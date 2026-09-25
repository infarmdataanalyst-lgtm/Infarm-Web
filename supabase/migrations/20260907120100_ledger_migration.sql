-- 20260907120100_ledger_migration.sql
-- Menutup inti SEC-036: tidak ada cara memastikan file migration mana yang sudah dijalankan.
--
-- ── Masalahnya ──
-- Supabase CLI belum terpasang di mesin ini, jadi migration dijalankan dengan copy-paste manual ke
-- Dashboard → SQL Editor. Tidak ada ledger, tidak ada checksum, tidak ada `db push`. Akibatnya repo
-- berhenti menjadi sumber kebenaran skema, dan setiap audit harus memverifikasi ulang ke database
-- live satu per satu.
--
-- Itu bukan kekhawatiran teoretis. 20260622100100_init_order_items.sql memuat
-- `alter table ... enable row level security`, tapi uji dengan anon key pada 2026-09-04 menunjukkan
-- SELECT/PATCH/DELETE ke public.order_items sama-sama membalas 200 dan SELURUH 75 baris terbaca.
-- Tabel itu ternyata dibuat manual lewat Dashboard di luar riwayat migration, sehingga baris RLS-nya
-- tak pernah benar-benar dieksekusi — dan tak ada apa pun yang bisa memberitahu kita.
--
-- ── Yang dilakukan file ini ──
-- Membuat tabel catatan `public.schema_migrations`. Ia TIDAK menjalankan apa pun secara otomatis;
-- ia hanya membuat kenyataan bisa dibaca. Sejak sekarang, setiap kali menjalankan sebuah file di
-- SQL Editor, catat namanya di sini (perintahnya ada di bagian bawah + di supabase/README.md).
--
-- Tabel ini metadata operasional, BUKAN data aplikasi: RLS aktif tanpa policy apa pun, jadi anon
-- maupun authenticated tak bisa menyentuhnya sama sekali. Hanya service_role (yang menembus RLS)
-- dan pengguna Dashboard yang bisa membacanya.

create table if not exists public.schema_migrations (
  version     text primary key,          -- nama file tanpa .sql, mis. '20260622100000_init_orders'
  applied_at  timestamptz not null default now(),
  note        text                       -- opsional: kenapa dilewati, siapa yang menjalankan, dll.
);

comment on table public.schema_migrations is
  'Catatan migration yang sudah dijalankan manual lewat Dashboard. Diisi TANGAN — lihat supabase/README.md. Ditambahkan untuk menutup SEC-036.';

alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

-- === Seed: apa yang SUDAH PASTI berjalan ===
--
-- Hanya file yang kondisi akhirnya terbukti ada di database live yang dicatat di sini. Yang masih
-- diragukan SENGAJA dibiarkan kosong — ledger yang berbohong lebih buruk daripada tidak ada ledger,
-- karena ia menghentikan orang dari memeriksa.
insert into public.schema_migrations (version, note) values
  ('20260622090000_init_products',        'terverifikasi: tabel + policy anon products ada'),
  ('20260622100000_init_orders',          'tabel live dibuat manual lebih dulu; file diselaraskan 2026-07-29 agar cocok'),
  ('20260622110000_init_reviews',         'terverifikasi 2026-09-07: anon membaca 9 baris visible, 1 baris tersembunyi ditahan RLS'),
  ('20260626120000_init_product_combos',  'terverifikasi: tabel ada & terkunci dari anon'),
  ('20260629120000_init_promotions',      'terverifikasi: tabel ada & terkunci dari anon'),
  ('20260708120000_init_admin_users',     'terverifikasi: login OMS berfungsi'),
  ('20260624120000_add_orders_customer_email', 'DINETRALKAN jadi no-op 2026-09-07 — kolom customer_email tak pernah ada & tak dibutuhkan (SEC-036)')
on conflict (version) do nothing;

-- === Cara memakai ===
--
-- Setelah menjalankan sebuah file migration di SQL Editor, jalankan juga:
--
--     insert into public.schema_migrations (version, note)
--     values ('20260907120000_policy_anon_combos_promotions', 'dijalankan manual')
--     on conflict (version) do nothing;
--
-- Untuk melihat apa yang tercatat:
--
--     select version, applied_at, note from public.schema_migrations order by version;
--
-- Yang MASIH BELUM PASTI dan perlu diverifikasi ke database (jangan dicatat sebelum dicek):
--   • 20260622100100_init_order_items          — RLS terbukti TIDAK aktif (lihat SEC-017)
--   • 20260904120000_stok_increment_atomik     — RPC increment atomik; kode punya jalur cadangan
--   • 20260904120100_aktifkan_rls_order_items  — perbaikan untuk order_items di atas
--   • seluruh migration penambahan kolom orders (ongkos_kirim, metode_pembayaran, warehouse_id,
--     shipment_*) — tipe OrderRow menandainya opsional justru karena ini tak pasti
