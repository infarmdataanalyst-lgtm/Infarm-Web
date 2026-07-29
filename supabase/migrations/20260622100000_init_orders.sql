-- supabase/migrations/20260622100000_init_orders.sql
-- Tabel orders (pesanan) — SKEMA ASLI (kolom Bahasa Indonesia + enum English) sesuai data layer
-- src/lib/mock-db/orders.ts (OrderRow) & RPC create_order_with_items.
--
-- Catatan sejarah: versi awal file ini memakai skema lama (order_id/items jsonb); skema asli dulu
-- dibuat/diubah manual di Dashboard. File ini diselaraskan agar migrations bisa dijalankan dari nol
-- di project Supabase baru. Enum disimpan sebagai text (English), dipetakan ke label Indonesia di app.

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  nomor_invoice     text unique,                    -- nomor pesanan pelanggan (INV-YYYYMMDD-XXXX)
  email             text,                           -- opsional (order baru selalu null)
  no_telepon        text,                           -- identitas guest (lacak/batalkan/review by phone)
  nama_customer     text not null,
  jumlah_total      integer not null,               -- total bayar (rupiah, tanpa desimal)
  shipping_address  text,                           -- detail jalan/no rumah
  provinsi          text,
  kota              text,
  kecamatan         text,
  kelurahan         text,
  kodepos           text,
  nama_ekspedisi    text,                           -- logistics.courier (mis. "JNE")
  jenis_layanan     text,                           -- logistics.service
  no_tracking       text,                           -- nomor resi (diisi saat dikirim)
  id_transaksi      text,                           -- id transaksi pembayaran (Xendit, nanti)
  destination_id    text,                           -- _id kelurahan Mengantar (cek ongkir/booking)
  status_pembayaran text not null default 'PENDING', -- PENDING|PAID|FAILED
  order_status      text not null default 'PENDING', -- PENDING|PROCESSING|SHIPPED|COMPLETED|CANCELLED
  created_at        timestamptz not null default now(),

  constraint orders_status_pembayaran_check check (status_pembayaran in ('PENDING', 'PAID', 'FAILED')),
  constraint orders_order_status_check check (
    order_status in ('PENDING', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED')
  )
);

-- Index: urutan terbaru, pencarian by phone (lacak/batalkan), pencarian resi
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_no_telepon_idx on public.orders (no_telepon);
create index if not exists orders_no_tracking_idx on public.orders (no_tracking);

-- === Row Level Security (RLS) ===
-- Berisi data pribadi (nama, telepon, alamat) → JANGAN dibuka ke anon. Semua baca/tulis lewat
-- server (service_role / createAdminClient) yang menembus RLS. Tanpa policy publik.
alter table public.orders enable row level security;
