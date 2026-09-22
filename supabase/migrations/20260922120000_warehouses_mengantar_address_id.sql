-- supabase/migrations/20260922120000_warehouses_mengantar_address_id.sql
-- Alamat PENJEMPUTAN Mengantar per gudang.
--
-- KENAPA kolom BARU dan bukan memakai mengantar_origin_id: keduanya ObjectId 24 hex dari Mengantar,
-- tapi menunjuk BENDA yang berbeda dan dipakai endpoint yang berbeda.
--   mengantar_origin_id  = _id KELURAHAN asal kirim   -> cek ongkir (GET allEstimatePublic)
--   mengantar_address_id = _id ALAMAT milik akun kita -> POST /time (address_id) & POST /order
--                                                        (pickup.address_id)
-- `POST /order` TIDAK punya field origin sama sekali: Mengantar menagih berdasarkan alamat
-- penjemputan. Itulah akar masalah "dikutip Surabaya, ditagih Cengkareng" (INV-20260820-4876) yang
-- sementara ini ditambal env MENGANTAR_PICKUP_ORIGIN_ID.
--
-- Terbukti di sandbox 22 Sep 2026 (Notion Testing Mengantar MGT-58 & MGT-60): biaya booking
-- dihitung dari PICKUP_AUTOFILL milik pickup.address_id, dan nilainya identik dengan kutipan
-- allEstimatePublic untuk origin yang sama — di dua zona (Jakarta Rp5.100, Surabaya Rp83.400).
--
-- NULL = gudang ini belum punya alamat sendiri dan tetap dijemput di alamat env
-- MENGANTAR_STORE_ADDRESS_ID. Karena itu migration ini AMAN dijalankan sebelum kodenya dideploy:
-- tak ada satu pun jalur yang berubah perilakunya hanya karena kolom ini muncul.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

alter table public.warehouses
  add column if not exists mengantar_address_id varchar;

comment on column public.warehouses.mengantar_address_id is
  '_id alamat penjemputan gudang ini di akun Mengantar (ObjectId 24 hex), hasil POST '
  '/api/public/{KEY}/address. Dipakai sebagai address_id pada POST /time dan pickup.address_id '
  'pada POST /order. BEDA dari mengantar_origin_id (itu _id kelurahan untuk cek ongkir). '
  'NULL = gudang ini masih menumpang alamat env MENGANTAR_STORE_ADDRESS_ID.';
