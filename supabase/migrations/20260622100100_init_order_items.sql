-- supabase/migrations/20260622100100_init_order_items.sql
-- Tabel anak order_items (satu baris per produk dalam sebuah pesanan).
-- CATATAN: tabel ini semula dibuat manual di Dashboard; file ini melengkapinya agar migrations
-- bisa dijalankan dari nol di project Supabase baru. Kolom is_promo_item/promotion_id/variant_id
-- ditambah oleh migration berikutnya (20260727*, 20260728*).
-- Jalankan SETELAH orders dibuat, SEBELUM 20260727120000_add_order_items_promo.sql.

create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  product_id        uuid,                         -- nullable: id dummy non-UUID → null
  quantity          integer not null check (quantity >= 1),
  price_at_purchase integer not null,             -- snapshot harga satuan saat beli (rupiah)
  created_at        timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- === RLS ===
-- Berisi data pesanan (terkait orders) → server-only via service_role. Tanpa policy publik.
alter table public.order_items enable row level security;
