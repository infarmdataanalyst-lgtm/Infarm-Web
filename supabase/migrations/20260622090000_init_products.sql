-- supabase/migrations/20260622090000_init_products.sql
-- Migration pertama: tabel products.
-- Dipetakan dari tipe StoredProduct (src/types/product.ts).
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI).

-- === Tabel products ===
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  original_price integer not null,           -- harga asli (rupiah, tanpa desimal)
  promo_price    integer not null,           -- harga jual efektif (rupiah)
  image_url      text not null,
  category       text not null,
  badge          text,                        -- opsional (mis. "Promo", "Baru")
  sku            text not null unique,
  stock          integer not null default 0,
  description    text,
  archived       boolean not null default false,  -- true = disembunyikan dari ecommerce, tetap ada di OMS
  created_at     timestamptz not null default now(),

  -- Batasi kategori agar konsisten dengan ProductCategory di types/product.ts
  constraint products_category_check check (
    category in (
      'benih-premium',
      'pupuk-nutrisi',
      'peralatan-berkebun',
      'pot-polybag',
      'media-tanam',
      'paket-berkebun'
    )
  )
);

-- Index untuk urutan "terbaru" dan filter kategori di katalog
create index if not exists products_created_at_idx on public.products (created_at desc);
create index if not exists products_category_idx on public.products (category);

-- === Row Level Security (RLS) ===
-- Wajib aktif di semua tabel (lihat Security Rules di CLAUDE.md).
alter table public.products enable row level security;

-- Storefront publik (anon) hanya boleh MEMBACA produk yang tidak diarsipkan.
-- Operasi tulis (create/update/delete) dilakukan dari OMS lewat service_role,
-- yang menembus RLS sehingga tidak butuh policy di sini.
drop policy if exists "Public dapat membaca produk aktif" on public.products;
create policy "Public dapat membaca produk aktif"
  on public.products
  for select
  to anon, authenticated
  using (archived = false);

-- === Grant akses Data API ===
-- Diperlukan bila opsi "Automatically expose new tables" dimatikan.
-- Aman dijalankan walau opsi itu menyala (idempotent).
grant select on public.products to anon, authenticated;
