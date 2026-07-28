-- supabase/migrations/20260728120100_add_order_items_variant.sql
-- Menautkan baris order_items ke varian produk yang dipilih (bila ada).
-- Nullable → order lama tanpa varian tetap valid. price_at_purchase tetap snapshot harga saat beli
-- (untuk produk bervarian = harga varian; diisi oleh server saat create order).
-- Jalankan via Dashboard -> SQL Editor SEBELUM update RPC di bawah.

alter table public.order_items
  add column if not exists variant_id uuid references public.product_variants (id);

create index if not exists order_items_variant_id_idx
  on public.order_items (variant_id)
  where variant_id is not null;
