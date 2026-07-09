-- supabase/migrations/20260708130000_add_reviews_order_invoice.sql
-- Mencegah ulasan GANDA: ikat ulasan ke pesanan asal (order_invoice = orders.nomor_invoice)
-- lalu unik-kan pasangan (order_invoice, product_id). Buka link review lagi → tak bisa isi ulang.
-- Dijalankan via Dashboard -> SQL Editor, urut sesuai timestamp.

alter table public.reviews
  add column if not exists order_invoice text;

comment on column public.reviews.order_invoice is
  'nomor_invoice pesanan asal ulasan. NULL untuk ulasan lama (sebelum kolom ini ada).';

-- Unik per (pesanan, produk). Partial index: baris lama tanpa order_invoice (NULL) tidak ikut
-- dibatasi, jadi tidak bentrok. Insert kedua untuk kombinasi sama → error 23505 (ditolak app).
create unique index if not exists reviews_order_invoice_product_uidx
  on public.reviews (order_invoice, product_id)
  where order_invoice is not null;
