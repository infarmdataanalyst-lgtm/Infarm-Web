-- supabase/migrations/20260727120000_add_order_items_promo.sql
-- Menandai item pesanan yang merupakan PRODUK GRATIS dari promosi type='free_product'.
-- Dijalankan via Dashboard -> SQL Editor (urut sesuai timestamp), SEBELUM update RPC di bawah.
--
-- is_promo_item : true bila baris ini produk hadiah (harga 0, tak menambah subtotal).
-- promotion_id  : id promosi (public.promotions) penyebab produk ini gratis. NULL untuk item normal.

alter table public.order_items
  add column if not exists is_promo_item boolean not null default false,
  add column if not exists promotion_id  uuid references public.promotions(id);

-- Index bantu bila nanti perlu laporan "berapa produk gratis terpakai per promo"
create index if not exists order_items_promotion_id_idx
  on public.order_items (promotion_id)
  where promotion_id is not null;
