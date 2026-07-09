-- supabase/migrations/20260629120000_init_promotions.sql
-- Migration: tabel promo (fitur "Promosi" OMS).
-- Dipetakan dari tipe Promotion/PromotionInput di src/types/promotion.ts.
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.

-- === Tabel promotions ===
-- Satu baris = satu promo. Status "Kedaluwarsa" TIDAK disimpan (dihitung di frontend dari end_at).
create table if not exists public.promotions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              text not null
    check (type in ('free_shipping', 'free_product', 'discount_nominal', 'discount_percent')),
  min_purchase      integer not null check (min_purchase >= 1000),  -- minimal pembelian (rupiah)
  -- Detail hadiah (terisi sesuai type; null untuk type lain):
  free_product_id   uuid,            -- id produk hadiah di public.products (snapshot, TANPA FK)
  free_product_name text,            -- snapshot nama produk hadiah saat promo dibuat/diedit
  discount_value    integer,         -- discount_nominal → rupiah; discount_percent → persen (1-100)
  -- Periode (opsional; null = tak terbatas):
  start_at          timestamptz,
  end_at            timestamptz,
  progress_message  text not null,   -- pesan progres di keranjang (boleh memuat token {sisa})
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Index untuk urutan "terbaru" di daftar promo
create index if not exists promotions_created_at_idx on public.promotions (created_at desc);

-- === Row Level Security (RLS) ===
-- Wajib aktif (lihat Security Rules di CLAUDE.md). Promo dikelola internal lewat OMS:
-- semua baca/tulis dari server via service_role (createAdminClient) yang menembus RLS.
-- Tidak ada policy publik → tabel terkunci dari akses anon (mirip tabel orders & product_combos).
alter table public.promotions enable row level security;
