-- supabase/migrations/20260728120000_init_product_variants.sql
-- Migration: tabel varian produk (1 dimensi, mis. ukuran/isi kemasan: "10 Biji", "50 Biji").
-- Dipetakan dari tipe ProductVariant di src/types/variant.ts.
-- Dijalankan via Dashboard -> SQL Editor (urut sesuai timestamp).
--
-- Varian bersifat OPSIONAL per produk: produk tanpa baris di sini tetap berfungsi seperti biasa
-- (harga & stok diambil dari tabel products). Bila produk punya varian, harga & stok diambil per-varian.

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  nama_varian varchar not null,                 -- label varian, mis. "50 Biji"
  sku         varchar not null unique,          -- SKU unik (aturan sama dengan SKU produk)
  harga       integer not null,                 -- harga jual varian (rupiah, tanpa desimal)
  stok        integer not null default 0,
  is_default  boolean not null default false,   -- varian terpilih otomatis saat halaman dibuka
  created_at  timestamptz not null default now()
);

-- Lookup varian per produk (dipakai halaman detail & saat baca order)
create index if not exists product_variants_product_id_idx on public.product_variants (product_id);

-- === Row Level Security (RLS) ===
-- Wajib aktif. Storefront publik (anon) boleh MEMBACA varian (harga/stok tampil di detail produk).
-- Tulis (create/update/delete) lewat OMS via service_role yang menembus RLS (tanpa policy khusus).
alter table public.product_variants enable row level security;

drop policy if exists "Public dapat membaca varian produk" on public.product_variants;
create policy "Public dapat membaca varian produk"
  on public.product_variants
  for select
  to anon, authenticated
  using (true);

grant select on public.product_variants to anon, authenticated;
