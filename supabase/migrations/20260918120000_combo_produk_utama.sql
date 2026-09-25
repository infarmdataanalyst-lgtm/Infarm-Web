-- supabase/migrations/20260918120000_combo_produk_utama.sql
-- Migration: penanda PRODUK UTAMA pada isi paket/combo (product_combo_items.is_primary).
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.
--
-- ── Kenapa ──
-- Sebelum ini semua anggota paket setara, sehingga sebuah paket tayang di halaman detail SETIAP
-- produk yang ada di dalamnya. Akibatnya cross-sell selalu dua arah: paket "A + B" ikut memajang
-- dirinya di halaman B, padahal margin B mungkin tipis dan B lebih baik disandingkan produk lain.
-- Dengan penanda ini, satu paket hanya tayang di halaman SATU produk yang dipilih pemilik toko.
--
-- Harga per produk (deal_price) SENGAJA belum ada di migration ini — itu tahap 2 dari usulan yang
-- sama. Tahap ini tidak menyentuh uang sama sekali: hanya menentukan paket tayang di halaman siapa.

-- === Kolom penanda ===
alter table public.product_combo_items
  add column if not exists is_primary boolean not null default false;

comment on column public.product_combo_items.is_primary is
  'true = produk utama paket. Paket hanya tayang di halaman detail produk ini.';

-- === Tepat satu produk utama per paket ===
-- Index unik PARSIAL: hanya baris ber-is_primary = true yang diikat, jadi anggota lain bebas.
-- Database ikut menahan, bukan cuma validasi aplikasi (pola yang sama dipakai di tabel lain).
create unique index if not exists product_combo_items_primary_idx
  on public.product_combo_items (combo_id)
  where is_primary;

-- === Isi data lama ===
-- Paket yang sudah ada belum punya produk utama. Default yang dipakai: anggota dengan SUBTOTAL
-- terbesar (harga satuan x quantity) — tebakan paling masuk akal untuk "produk yang dijual", bukan
-- pelengkapnya. Pemilik toko bisa memindahkannya lewat form Paket & Combo di OMS.
--
-- Blok ini aman dijalankan ulang: paket yang sudah punya produk utama dilewati.
with peringkat as (
  select
    id,
    combo_id,
    row_number() over (
      partition by combo_id
      order by (unit_price * quantity) desc, id
    ) as urutan
  from public.product_combo_items
)
update public.product_combo_items as item
set is_primary = true
from peringkat
where peringkat.id = item.id
  and peringkat.urutan = 1
  and not exists (
    select 1
    from public.product_combo_items as lain
    where lain.combo_id = item.combo_id
      and lain.is_primary
  );

-- === RLS ===
-- Tidak ada perubahan policy. Kolom ini ikut policy "Public dapat membaca combo aktif"
-- (migration 20260907120000) karena storefront memang perlu tahu paket ini milik halaman siapa.
