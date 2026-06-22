-- supabase/migrations/20260622100000_init_orders.sql
-- Tabel orders (pesanan). Dipetakan dari tipe Order & OrderItem (src/types/order.ts).
-- Dijalankan via Dashboard -> SQL Editor.
--
-- Catatan desain: items & logistik disimpan apa adanya agar bentuknya 1:1 dengan
-- tipe Order di aplikasi (mempermudah migrasi mock-db/orders.ts; signature tetap sama).
-- items berupa JSONB array: [{ "productId", "name", "quantity", "price" }, ...].
-- Bila nanti perlu query per-item (mis. laporan produk terlaris), bisa dinormalisasi
-- ke tabel order_items terpisah.

-- === Tabel orders ===
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),  -- id internal DB
  order_id        text not null unique,                        -- nomor pesanan untuk pelanggan (mis. "INF...")
  customer_name   text not null,
  customer_phone  text,
  order_date      timestamptz not null,                        -- tanggal pesan (dari payload checkout)
  items           jsonb not null default '[]'::jsonb,          -- daftar item pesanan
  total_amount    integer not null,                            -- total bayar (rupiah, tanpa desimal)
  payment_status  text not null default 'Lunas',
  status          text,                                        -- alur fulfillment; diisi aplikasi
  courier         text,                                        -- logistics.courier (mis. "JNE")
  service         text,                                        -- logistics.service (mis. "Reguler")
  tracking_number text,                                        -- nomor resi
  created_at      timestamptz not null default now(),          -- waktu insert ke DB

  -- Batasi status agar konsisten dengan OrderPaymentStatus & OrderFulfillmentStatus
  constraint orders_payment_status_check check (
    payment_status in ('Lunas', 'Menunggu', 'Gagal')
  ),
  constraint orders_status_check check (
    status is null or status in (
      'Menunggu Pembayaran',
      'Diproses',
      'Dikirim',
      'Selesai',
      'Dibatalkan'
    )
  )
);

-- Index untuk urutan terbaru (OMS menampilkan pesanan terbaru di atas) & pencarian resi
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_tracking_number_idx on public.orders (tracking_number);

-- === Row Level Security (RLS) ===
-- Pesanan berisi data pribadi (nama, telepon) -> JANGAN dibuka ke publik (anon).
-- Semua baca/tulis pesanan dilakukan dari server lewat service_role (createAdminClient),
-- yang menembus RLS. Tanpa policy untuk anon -> akses publik otomatis ditolak.
alter table public.orders enable row level security;

-- Sengaja TIDAK ada policy untuk anon. (Akses publik /track nanti lewat API server,
-- bukan query langsung dari browser.)
