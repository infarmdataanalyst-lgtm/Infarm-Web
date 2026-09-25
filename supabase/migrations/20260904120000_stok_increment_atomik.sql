-- supabase/migrations/20260904120000_stok_increment_atomik.sql
-- Increment stok ATOMIK di SQL, menggantikan pola baca-lalu-tulis di aplikasi (menutup SEC-020).
--
-- MASALAH YANG DITUTUP
-- adjustWarehouseStock() dan jalur cadangan di restoreStock() dulu membaca stok lebih dulu, lalu
-- menuliskan kembali stok + qty sebagai nilai MUTLAK. Dua permintaan yang tiba nyaris bersamaan
-- (double-click, retry jaringan, dua tab, atau dua pesanan berbeda yang memuat produk sama)
-- sama-sama membaca angka LAMA, lalu keduanya menulis hasil yang dihitung dari angka lama itu.
-- Yang menulis belakangan menang, dan satu penambahan hilang tanpa jejak. Ini lost update klasik:
-- tak ada error, tak ada log, angkanya cuma salah.
--
-- Fungsi di bawah menyerahkan penjumlahannya ke Postgres (stok = stok + delta dalam SATU
-- pernyataan UPDATE), sehingga baris terkunci selama operasi dan penambahan tak bisa saling
-- menimpa — berapa pun banyaknya permintaan yang datang bersamaan.
--
-- greatest(0, ...) dipertahankan dari kode lama: stok tak boleh menjadi negatif meski delta
-- negatif melebihi stok yang ada.
--
-- CATATAN PENERAPAN
-- Aplikasi TIDAK bergantung pada migration ini untuk tetap berjalan. src/lib/mock-db/warehouses.ts
-- dan products.ts memanggil RPC ini lebih dulu, dan bila fungsinya belum ada (kode 42883/PGRST202)
-- mereka jatuh ke pola baca-lalu-tulis yang lama sambil menulis peringatan ke log server. Jadi
-- sampai SQL ini dijalankan, perilakunya persis seperti sebelumnya — tidak rusak, tapi juga belum
-- terlindungi. Jalankan di SQL Editor Supabase untuk benar-benar menutup temuannya.

-- === Stok per gudang ===
-- Mengembalikan stok SESUDAH penyesuaian, atau null bila barisnya tidak ada.
create or replace function public.adjust_warehouse_stock_atomic(
  p_product_id   uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_delta        integer
)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.product_stock_per_warehouse
     set stok = greatest(0, stok + p_delta)
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id
     and (variant_id is not distinct from p_variant_id)
  returning stok;
$$;

-- === Stok kolom lama products.stock ===
-- Jaring pengaman untuk produk yang belum punya baris stok per gudang.
create or replace function public.adjust_product_stock_atomic(
  p_product_id uuid,
  p_delta      integer
)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.products
     set stock = greatest(0, stock + p_delta)
   where id = p_product_id
  returning stock;
$$;

-- Hanya service_role yang boleh memanggil: seluruh akses stok di aplikasi lewat createAdminClient.
-- anon/authenticated SENGAJA tidak diberi execute — fungsi ini security definer dan mengubah stok.
revoke all on function public.adjust_warehouse_stock_atomic(uuid, uuid, uuid, integer) from public;
revoke all on function public.adjust_product_stock_atomic(uuid, integer) from public;
grant execute on function public.adjust_warehouse_stock_atomic(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.adjust_product_stock_atomic(uuid, integer) to service_role;
