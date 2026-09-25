-- supabase/migrations/20260918160000_reviews_sumber.sql
-- Migration: asal-usul sebuah ulasan (reviews.source).
-- Dijalankan via Dashboard -> SQL Editor (belum pakai Supabase CLI), urut sesuai timestamp.
--
-- ── Kenapa ──
-- Menjelang peluncuran, katalog perlu terisi ulasan awal yang dimasukkan dari sisi admin (testimoni
-- dari marketplace lain, hasil uji produk internal). Tanpa penanda, ulasan seperti itu bercampur
-- dengan ulasan pembeli sungguhan dan TAK BISA DIPISAHKAN LAGI — termasuk saat kelak ingin dihapus
-- massal setelah ulasan asli berdatangan. Kolom ini yang membedakannya.
--
--   'buyer'    = dikirim pembeli lewat /review, terikat ke pesanan (order_invoice terisi)
--   'internal' = dimasukkan admin lewat OMS, bukan dari pembeli
--
-- ── Yang TIDAK dilakukan kolom ini ──
-- Ia tidak ditampilkan di halaman produk. Keputusan pemilik proyek 2026-09-18: ulasan internal
-- tampil sama seperti ulasan lain di storefront, penandanya hanya untuk admin di OMS. Konsekuensinya
-- dicatat terbuka: pengunjung tak punya cara membedakan keduanya. Kalau kelak ingin ditampilkan,
-- cukup teruskan kolom ini ke ProductReview — datanya sudah ada sejak sekarang.
--
-- Catatan keterbukaan: kolom ini ikut terbaca anon lewat Data API (storefront memakai select *),
-- jadi ia tidak rahasia — ia pemisah data, bukan penyamaran.

alter table public.reviews
  add column if not exists source text not null default 'buyer';

alter table public.reviews
  drop constraint if exists reviews_source_check;

alter table public.reviews
  add constraint reviews_source_check check (source in ('buyer', 'internal'));

comment on column public.reviews.source is
  'Asal ulasan: buyer = dari pembeli lewat /review; internal = dimasukkan admin lewat OMS.';

-- Index parsial: satu-satunya pertanyaan yang sering diajukan ke kolom ini adalah "mana yang
-- internal?" (menandai di OMS, menghapus massal nanti). Baris 'buyer' tak perlu ikut diindeks.
create index if not exists reviews_source_internal_idx
  on public.reviews (created_at desc)
  where source = 'internal';

-- === Data lama ===
-- Seluruh baris yang sudah ada otomatis bernilai 'buyer' lewat DEFAULT — benar, karena sampai hari
-- ini satu-satunya jalan masuk ulasan adalah form /review milik pembeli.

-- === RLS ===
-- Tidak ada perubahan policy. Penulisan ulasan internal dilakukan server lewat service_role
-- (createAdminClient) di endpoint OMS ber-guard admin, bukan dari browser.
