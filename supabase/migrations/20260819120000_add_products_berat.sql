-- supabase/migrations/20260819120000_add_products_berat.sql
-- Berat produk (GRAM) sebagai dasar perhitungan ongkir Mengantar.
--
-- Latar belakang: sebelum kolom ini ada, checkout mengirim JUMLAH PCS sebagai kilogram ke
-- allEstimatePublic (WEIGHT_PER_ITEM_KG = 1 di src/app/checkout/page.tsx). Beli 5 bungkus benih
-- yang beratnya ±0,5 kg ditagih sebagai 5 kg → ongkir bisa 5× lebih mahal dari semestinya.
--
-- SATUAN: GRAM, integer — konsisten dengan konvensi harga project (rupiah bulat, tanpa desimal).
-- API Mengantar meminta KILOGRAM (terbukti empiris: weight=1000 menghasilkan tarif 1000 kg,
-- bukan 1 kg), jadi konversi gram → kg dilakukan di aplikasi, bukan di DB.
--
-- NULL-ABLE, TANPA DEFAULT — disengaja:
--   * NULL = "admin belum mengisi berat" secara tak ambigu → badge peringatan di OMS akurat.
--     Kalau kolomnya NOT NULL DEFAULT <angka>, produk yang beratnya MEMANG sebesar angka itu
--     akan terus dibadge "belum diisi" selamanya (false positive yang tak bisa dihilangkan).
--   * Kalkulasi ongkir memakai fallback DEFAULT_WEIGHT_GRAM (1000 g) untuk baris NULL, sehingga
--     produk lama menghasilkan ongkir yang IDENTIK dengan perilaku sebelum migration ini —
--     tak ada penurunan tarif mendadak yang selisihnya ditanggung toko.
--   * Produk baru wajib mengisi berat lewat form OMS, jadi NULL hanya dimiliki data lama.
--
-- Jalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.

alter table public.products
  add column if not exists berat integer;

-- Constraint dipisah + guard: `add constraint` tak punya `if not exists` di Postgres,
-- jadi migration ini tetap idempoten saat dijalankan ulang.
-- Batas atas 1.000.000 g (1 ton) = jaring pengaman salah input (mis. admin mengetik 500000
-- untuk 500 gram), bukan batas bisnis.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_berat_check'
  ) then
    alter table public.products
      add constraint products_berat_check check (berat is null or (berat >= 1 and berat <= 1000000));
  end if;
end $$;

comment on column public.products.berat is
  'Berat satuan produk dalam GRAM (integer). NULL = belum diisi admin → aplikasi memakai '
  'fallback 1000 g saat menghitung ongkir dan menampilkan badge peringatan di OMS. '
  'Dikonversi ke kilogram sebelum dikirim ke Mengantar (allEstimatePublic meminta kg).';
