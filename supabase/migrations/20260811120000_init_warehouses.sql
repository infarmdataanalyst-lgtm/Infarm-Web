-- supabase/migrations/20260811120000_init_warehouses.sql
-- Migration: pergudangan (warehouses) + stok per gudang, dengan toggle single/multi warehouse.
--
-- TUJUAN: menyiapkan STRUKTUR multi-gudang tanpa mengubah perilaku sistem sekarang.
-- Selama env WAREHOUSE_MODE=single (default), aplikasi tetap beroperasi seperti sebelumnya —
-- migration ini hanya MENAMBAH tabel/kolom, tidak menghapus atau mengubah kolom mana pun.
--
-- Kolom stok lama SENGAJA DIPERTAHANKAN:
--   - public.products.stock          (produk tanpa varian)
--   - public.product_variants.stok   (produk bervarian)
-- Keduanya tetap disinkronkan (mirror) oleh RPC & data layer, sehingga semua pembaca lama
-- (katalog, keranjang, dashboard OMS) tidak perlu diubah dan tidak bisa "kosong" mendadak.
--
-- Dijalankan via Dashboard -> SQL Editor, urut sesuai timestamp. Aman dijalankan ulang (idempotent).

-- === 1. Tabel warehouses ===
create table if not exists public.warehouses (
  id                  uuid primary key default gen_random_uuid(),
  nama                varchar not null,
  alamat              text,
  mengantar_origin_id varchar,                        -- _id kelurahan asal kirim (origin_id Mengantar)
  latitude            numeric(10, 7),                 -- untuk hitung jarak (Haversine) di mode multi
  longitude           numeric(10, 7),
  is_default          boolean not null default false, -- gudang yang dipakai di mode single
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Hanya BOLEH ada satu gudang default. Index partial: baris is_default=false tidak dibatasi.
-- Tanpa ini, getDefaultWarehouse() bisa mengembalikan gudang yang berbeda-beda antar request.
create unique index if not exists warehouses_single_default_idx
  on public.warehouses (is_default)
  where is_default;

-- === 2. Tabel stok per gudang ===
-- variant_id NULL  = stok produk tanpa varian
-- variant_id terisi = stok satu varian di gudang tsb (produk bervarian punya stok per varian)
create table if not exists public.product_stock_per_warehouse (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  variant_id   uuid references public.product_variants (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  stok         integer not null default 0,
  created_at   timestamptz not null default now(),

  constraint product_stock_per_warehouse_stok_check check (stok >= 0)
);

-- Postgres menganggap NULL sebagai nilai yang selalu berbeda, sehingga UNIQUE biasa tidak
-- mencegah baris ganda saat variant_id NULL. Karena itu dipakai DUA index partial.
create unique index if not exists product_stock_per_warehouse_product_idx
  on public.product_stock_per_warehouse (product_id, warehouse_id)
  where variant_id is null;

create unique index if not exists product_stock_per_warehouse_variant_idx
  on public.product_stock_per_warehouse (product_id, variant_id, warehouse_id)
  where variant_id is not null;

-- Lookup "stok apa saja di gudang X" (dipakai halaman OMS per gudang di mode multi)
create index if not exists product_stock_per_warehouse_warehouse_idx
  on public.product_stock_per_warehouse (warehouse_id);

-- === 3. orders.warehouse_id ===
-- NULL diperbolehkan: pesanan lama (sebelum migration ini) tidak punya gudang tercatat.
alter table public.orders
  add column if not exists warehouse_id uuid references public.warehouses (id);

create index if not exists orders_warehouse_id_idx on public.orders (warehouse_id);

-- === 4. Row Level Security ===
-- Kedua tabel dikunci dari publik: tidak ada policy untuk anon/authenticated.
-- mengantar_origin_id adalah data operasional toko (jangan bocor ke bundel klien), dan stok
-- per gudang dibaca lewat server (createAdminClient / service_role yang menembus RLS).
alter table public.warehouses enable row level security;
alter table public.product_stock_per_warehouse enable row level security;

-- === 5. Seed gudang default ===
-- mengantar_origin_id di bawah = nilai NEXT_PUBLIC_MENGANTAR_ORIGIN_ID yang sedang dipakai.
-- Bukan rahasia (dulu memang ter-inline ke bundel klien), tapi setelah migration ini sumber
-- kebenarannya adalah baris DB ini — env dipakai hanya sebagai fallback.
-- GANTI nama/alamat sesuai gudang sebenarnya lewat OMS atau UPDATE manual.
insert into public.warehouses (nama, alamat, mengantar_origin_id, is_default, is_active)
select 'Gudang Utama Infarm', null, '5fc6461ef8f44b34aa4cd807', true, true
where not exists (select 1 from public.warehouses where is_default);

-- === 6. Migrasi data stok yang sudah ada → gudang default ===
-- Nilai stok lama dipindahkan APA ADANYA (bukan diubah/dibagi), jadi total stok tiap produk
-- tetap sama persis seperti sebelum migration.

-- 6a. Produk TANPA varian → satu baris per produk (variant_id NULL)
insert into public.product_stock_per_warehouse (product_id, variant_id, warehouse_id, stok)
select p.id, null, w.id, p.stock
from public.products p
cross join (select id from public.warehouses where is_default limit 1) w
where not exists (
  select 1 from public.product_variants v where v.product_id = p.id
)
on conflict do nothing;

-- 6b. Produk BERVARIAN → satu baris per varian (stok diambil dari product_variants.stok)
insert into public.product_stock_per_warehouse (product_id, variant_id, warehouse_id, stok)
select v.product_id, v.id, w.id, v.stok
from public.product_variants v
cross join (select id from public.warehouses where is_default limit 1) w
on conflict do nothing;
