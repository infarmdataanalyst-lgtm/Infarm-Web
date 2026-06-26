-- supabase/migrations/20260626120000_init_product_combos.sql
-- Migration: tabel paket/combo produk (fitur "Paket & Combo" OMS).
-- Dipetakan dari tipe ProductCombo/ComboItem di src/types/combo.ts.
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.

-- === Tabel product_combos ===
-- Satu baris = satu paket/combo. Harga normal TIDAK disimpan (dihitung dari item),
-- hanya combo_price (harga jual paket) yang dipersist.
create table if not exists public.product_combos (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  combo_price integer not null,                  -- harga jual paket (rupiah, tanpa desimal)
  is_active   boolean not null default true,     -- false = nonaktif (tidak dijual)
  created_at  timestamptz not null default now()
);

-- === Tabel product_combo_items ===
-- Produk-produk yang tergabung dalam sebuah combo.
-- name & unit_price disimpan sebagai SNAPSHOT saat combo dibuat/diedit, agar baris combo
-- tetap konsisten meski produk sumber kelak berubah/terhapus. product_id sengaja TANPA
-- foreign key ke products: combo bisa memakai produk yang nanti dihapus, dan kita tetap
-- ingin menampilkan snapshot-nya.
create table if not exists public.product_combo_items (
  id         uuid primary key default gen_random_uuid(),
  combo_id   uuid not null references public.product_combos (id) on delete cascade,
  product_id uuid not null,                      -- id produk di public.products (snapshot, tanpa FK)
  name       text not null,                      -- snapshot nama produk saat ditambahkan
  unit_price integer not null,                   -- snapshot harga satuan saat ditambahkan
  quantity   integer not null default 1 check (quantity >= 1)
);

-- Index untuk urutan "terbaru" di daftar combo & lookup item per combo
create index if not exists product_combos_created_at_idx on public.product_combos (created_at desc);
create index if not exists product_combo_items_combo_id_idx on public.product_combo_items (combo_id);

-- === Row Level Security (RLS) ===
-- Wajib aktif (lihat Security Rules di CLAUDE.md). Combo dikelola internal lewat OMS:
-- semua baca/tulis dilakukan dari server via service_role (createAdminClient) yang menembus RLS.
-- Tidak ada policy publik → tabel terkunci dari akses anon (mirip tabel orders).
alter table public.product_combos enable row level security;
alter table public.product_combo_items enable row level security;
