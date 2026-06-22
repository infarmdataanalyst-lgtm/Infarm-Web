-- supabase/migrations/20260622110000_init_reviews.sql
-- Tabel reviews (ulasan produk). Menyatukan kebutuhan storefront (ProductReview)
-- dan OMS (OmsReview) dalam satu tabel. Dipetakan dari src/types/product.ts.
-- Dijalankan via Dashboard -> SQL Editor (jalankan SETELAH migration products).
--
-- Pemetaan field aplikasi:
--   author_name  <- authorName / customerName
--   image_urls   <- imageUrls / images (array URL foto)
--   reply        <- balasan admin (OMS)
--   visible      <- OMS bisa menyembunyikan ulasan dari storefront
-- productName/productSku di OMS diambil lewat join ke tabel products (product_id).

-- === Tabel reviews ===
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  author_name text not null,
  rating      smallint not null,
  comment     text not null,
  category    text,                                  -- kategori filter ulasan (mis. "Kualitas", "Pengiriman")
  image_urls  jsonb not null default '[]'::jsonb,    -- array URL foto ulasan
  reply       text,                                  -- balasan admin (opsional)
  visible     boolean not null default true,         -- false = disembunyikan dari storefront
  created_at  timestamptz not null default now(),

  constraint reviews_rating_check check (rating between 1 and 5)
);

-- Index untuk ambil ulasan per produk, terbaru dulu
create index if not exists reviews_product_id_idx on public.reviews (product_id, created_at desc);

-- === Row Level Security (RLS) ===
alter table public.reviews enable row level security;

-- Storefront publik hanya boleh MEMBACA ulasan yang ditampilkan (visible = true).
-- Penulisan ulasan dari form /review dilakukan lewat API server (service_role) agar
-- bisa divalidasi dulu, bukan insert langsung dari browser.
drop policy if exists "Public dapat membaca ulasan tampil" on public.reviews;
create policy "Public dapat membaca ulasan tampil"
  on public.reviews
  for select
  to anon, authenticated
  using (visible = true);

-- === Grant akses Data API ===
grant select on public.reviews to anon, authenticated;
