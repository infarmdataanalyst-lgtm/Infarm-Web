-- 20260810120000_add_min_order.sql
-- Minimum pembelian: (A) kelipatan minimum per produk, (B) minimum total belanja global.
--
-- Latar belakang: sebagian produk berharga sangat kecil (mis. Rp300/pcs). Order bernilai
-- sangat kecil bermasalah dua arah:
--   1) Payment gateway (Xendit) punya batas minimum transaksi (±Rp10.000) → invoice gagal dibuat.
--   2) Ongkir & biaya penanganan bersifat tetap per order → order Rp300 merugi.
-- Mekanisme A saja tidak cukup menjamin B (gabungan beberapa produk murah tetap bisa di bawah
-- minimum), jadi keduanya dipakai bersamaan.

-- === A. Minimum kuantitas per produk ===
alter table public.products
  add column if not exists min_order_qty integer not null default 1;

-- Constraint dipisah + guard: `add constraint` tidak punya `if not exists` di Postgres,
-- jadi migration ini tetap idempoten saat dijalankan ulang.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_min_order_qty_check'
  ) then
    alter table public.products
      add constraint products_min_order_qty_check check (min_order_qty >= 1);
  end if;
end $$;

comment on column public.products.min_order_qty is
  'Minimum pembelian per baris keranjang (pcs). Default 1 = tanpa batasan.';

-- === B. Pengaturan toko (key-value) ===
-- Tabel generik agar setting berikutnya tak perlu migration kolom baru tiap kali.
create table if not exists public.store_settings (
  id         uuid primary key default gen_random_uuid(),
  key        varchar not null unique,
  value      text not null,
  updated_at timestamptz not null default now()
);

comment on table public.store_settings is
  'Pengaturan toko yang bisa diubah admin lewat OMS tanpa deploy ulang. Nilai disimpan TEXT; '
  'pemakai wajib meng-cast sesuai kebutuhan (harga → INTEGER rupiah, sesuai konvensi project).';

-- RLS aktif TANPA policy publik: sama seperti `orders` & `admin_users`.
-- Semua baca/tulis lewat server (service_role). Storefront membaca nilainya lewat endpoint
-- publik read-only yang hanya mengembalikan min_order_amount, bukan seluruh isi tabel.
alter table public.store_settings enable row level security;

-- Seed minimum total belanja awal (rupiah, INTEGER saat dipakai di kode).
-- Angka 15.000 memberi jarak aman di atas batas minimum Xendit (±10.000) supaya order tetap
-- lolos meski ada diskon promo yang menurunkan total tagihan.
insert into public.store_settings (key, value)
values ('min_order_amount', '15000')
on conflict (key) do nothing;
