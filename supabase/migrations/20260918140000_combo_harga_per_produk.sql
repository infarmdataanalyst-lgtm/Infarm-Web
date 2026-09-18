-- supabase/migrations/20260918140000_combo_harga_per_produk.sql
-- Migration: harga paket per produk (product_combo_items.deal_price).
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.
-- Tahap 2 dari usulan yang sama dengan migration 20260918120000 (produk utama).
--
-- ── Kenapa ──
-- Sebelum ini admin hanya mengetik SATU harga paket, lalu sistem membagi potongannya ke tiap produk
-- secara PROPORSIONAL terhadap harga normal (allocateComboPrices). Akibatnya produk bermargin tipis
-- ikut menanggung diskon, padahal yang seharusnya "membayar" diskon adalah produk bermargin tebal.
-- Dengan kolom ini, admin menentukan sendiri harga tiap produk di dalam paket, dan harga paket
-- menjadi HASIL penjumlahan — bukan angka yang diketik terpisah lalu dibagi-bagi sistem.
--
-- ── deal_price adalah harga SATUAN di dalam paket ──
-- Sejajar dengan unit_price (harga satuan normal). Subtotal baris = deal_price * quantity, dan
-- product_combos.combo_price = jumlah seluruh subtotal itu.

-- === Kolom harga paket per produk ===
-- NULL = paket lama yang harganya belum dipecah per produk. Baris seperti itu tetap dijual memakai
-- pembagian proporsional yang lama, jadi tak ada pesanan/keranjang yang berubah harganya hanya
-- karena migration ini dijalankan.
alter table public.product_combo_items
  add column if not exists deal_price integer;

alter table public.product_combo_items
  drop constraint if exists product_combo_items_deal_price_check;

alter table public.product_combo_items
  add constraint product_combo_items_deal_price_check
  check (deal_price is null or deal_price >= 0);

comment on column public.product_combo_items.deal_price is
  'Harga SATUAN produk ini di dalam paket (rupiah). NULL = paket lama, harga dibagi proporsional. '
  'Jumlah (deal_price * quantity) seluruh anggota = product_combos.combo_price.';

-- === Tidak ada pengisian data lama, disengaja ===
-- Mengisi deal_price untuk paket lama berarti menuliskan hasil pembagian proporsional ke database —
-- pembulatannya harus persis sama dengan allocateComboPrices, dan sekali meleset seribu rupiah,
-- harga paket di keranjang tak lagi sama dengan combo_price. Lebih aman dibiarkan NULL: kode sudah
-- memakai pembagian lama untuk baris seperti itu, dan angkanya terisi sendiri begitu paketnya
-- disimpan ulang lewat form OMS.

-- === RLS ===
-- Tidak ada perubahan policy; kolom ikut policy "Public dapat membaca combo aktif"
-- (migration 20260907120000), sama seperti kolom harga lain di tabel ini.
