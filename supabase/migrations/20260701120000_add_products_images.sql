-- supabase/migrations/20260701120000_add_products_images.sql
-- Menambahkan kolom galeri foto (maks 9) ke tabel products.
-- image_url tetap = foto utama (= images[0]) agar kartu/katalog lama tidak berubah.
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.

alter table public.products
  add column if not exists images jsonb not null default '[]'::jsonb;

comment on column public.products.images is
  'Galeri foto produk (array data URL/URL, maks 9). images[0] = foto utama (mirror image_url).';
