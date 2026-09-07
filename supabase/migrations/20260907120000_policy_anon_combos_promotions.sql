-- 20260907120000_policy_anon_combos_promotions.sql
-- Menutup SEC-031: product_combos, product_combo_items, dan promotions dikunci TOTAL (RLS aktif
-- tanpa satu pun policy), padahal baris ber-`is_active = true` memang data publik yang tampil di
-- storefront. Akibatnya storefront terpaksa membacanya lewat service_role yang MENEMBUS RLS,
-- sehingga RLS kehilangan perannya sebagai lapisan pertahanan kedua di jalur baca publik ini.
--
-- Sesudah migration ini, jalur bacanya sama persis dengan pola `reviews` yang sudah terbukti:
-- policy anon + grant select, lalu kode aplikasi memakai anon key. Satu bug filter di TypeScript
-- tak lagi cukup untuk membocorkan combo/promo yang sengaja dinonaktifkan — database ikut menahan.
--
-- IDEMPOTEN: aman dijalankan berulang (drop policy if exists sebelum create).
--
-- ⚠️ URUTAN PENTING: jalankan SQL ini LEBIH DULU, baru deploy kode yang memakai anon key.
-- Kalau dibalik, storefront kehilangan seluruh combo & promo sampai policy-nya ada.

-- === product_combos ===
-- Hanya paket aktif yang boleh terbaca publik. Paket nonaktif = draf/arsip milik OMS.
drop policy if exists "Public dapat membaca combo aktif" on public.product_combos;
create policy "Public dapat membaca combo aktif"
  on public.product_combos
  for select
  to anon, authenticated
  using (is_active = true);

-- === product_combo_items ===
-- Tabel anak tak punya kolom is_active sendiri; visibilitasnya MENGIKUTI induknya lewat EXISTS.
-- Tanpa ini, isi paket nonaktif tetap terbaca walau nama paketnya tidak — bocor sebagian.
drop policy if exists "Public dapat membaca isi combo aktif" on public.product_combo_items;
create policy "Public dapat membaca isi combo aktif"
  on public.product_combo_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.product_combos c
      where c.id = product_combo_items.combo_id
        and c.is_active = true
    )
  );

-- === promotions ===
-- Jendela waktu (start_at/end_at) SENGAJA tidak ikut jadi predikat policy: storefront perlu
-- membedakan "promo belum mulai" dari "promo tidak ada" untuk menampilkan hitung mundur, dan
-- keduanya bukan data rahasia. Yang dijaga di sini hanya is_active.
drop policy if exists "Public dapat membaca promo aktif" on public.promotions;
create policy "Public dapat membaca promo aktif"
  on public.promotions
  for select
  to anon, authenticated
  using (is_active = true);

-- === Grant akses Data API ===
-- RLS menyaring BARIS; grant membuka TABELNYA. Keduanya wajib — policy tanpa grant tetap 401.
-- Hanya select: seluruh penulisan combo & promo tetap lewat OMS (service_role).
grant select on public.product_combos to anon, authenticated;
grant select on public.product_combo_items to anon, authenticated;
grant select on public.promotions to anon, authenticated;
