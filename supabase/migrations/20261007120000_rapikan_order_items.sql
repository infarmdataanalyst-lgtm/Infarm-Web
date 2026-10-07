-- supabase/migrations/20261007120000_rapikan_order_items.sql
-- Fase 1 audit database (2026-10-07): menyelaraskan `order_items` di production dengan file
-- migration, TANPA mengubah perilaku aplikasi.
--
-- ── Kenapa perlu ──
-- order_items dibuat MANUAL di Dashboard sebelum ada migration-nya. Hasil audit (query pemilik
-- terhadap pg_constraint & information_schema, 2026-10-06):
--   - FK GANDA: order_items_order_id_fkey + fk_order_items_order (keduanya ke orders, cascade),
--     order_items_product_id_fkey + fk_order_items_product (keduanya ke products).
--   - order_items_product_id_fkey TIDAK PERNAH dibuat oleh migration mana pun.
--   - price_at_purchase bertipe numeric (file init: integer); created_at bertipe timestamp TANPA
--     zona waktu (file init: timestamptz). Nilainya terbukti tersimpan dalam UTC — sama persis
--     dengan orders.created_at untuk pesanan yang sama.
-- Akibatnya database yang dibangun ulang dari migration (mis. project preview) TIDAK sama dengan
-- production. File ini menutup selisih itu.
--
-- ── Yang SENGAJA tidak diubah di sini (Fase 2) ──
-- Aturan hapus tetap sama: produk/varian/promo yang pernah dipesan tetap DITOLAK dihapus — hanya
-- ditulis eksplisit sebagai RESTRICT (NO ACTION sebelumnya berperilaku sama untuk FK yang tak
-- ditangguhkan). FK untuk combo_id juga tidak ditambahkan: `set null` akan menghapus jejak
-- penjualan paket (lib/mock-db/combos.ts menghitung paket terjual dari kolom ini).
--
-- ── Aman dijalankan di database mana pun ──
-- Semua langkah memakai `if exists` / pemeriksaan tipe, jadi hasil akhirnya sama di production
-- (tabel buatan manual) maupun di database baru yang dibangun dari migration.
--
-- Prasyarat yang sudah dicek pemilik: tak ada order_items dengan order_id NULL (0 baris), tak ada
-- price_at_purchase pecahan (0 dari 131), tak ada product_id yang menunjuk produk terhapus.
-- Satu migration = satu transaksi di SQL Editor: bila satu langkah gagal, SEMUANYA dibatalkan.

-- === 1. Buang FK ganda (pertahankan yang bernama standar) ===
alter table public.order_items drop constraint if exists fk_order_items_order;
alter table public.order_items drop constraint if exists fk_order_items_product;

-- === 2. FK ditulis ulang dengan aturan EKSPLISIT — perilakunya tetap: tolak penghapusan ===
alter table public.order_items drop constraint if exists order_items_product_id_fkey;
alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products (id) on delete restrict;

alter table public.order_items drop constraint if exists order_items_variant_id_fkey;
alter table public.order_items
  add constraint order_items_variant_id_fkey
  foreign key (variant_id) references public.product_variants (id) on delete restrict;

alter table public.order_items drop constraint if exists order_items_promotion_id_fkey;
alter table public.order_items
  add constraint order_items_promotion_id_fkey
  foreign key (promotion_id) references public.promotions (id) on delete restrict;

-- === 3. Tipe kolom ===

-- Uang = integer rupiah, seperti seluruh kolom uang lain dan v_price di RPC checkout.
alter table public.order_items
  alter column price_at_purchase type integer using round(price_at_purchase)::integer;

-- created_at → timestamptz HANYA bila masih tanpa zona waktu. Di database baru kolom ini sudah
-- timestamptz sejak file init; mengonversinya lagi dengan `at time zone` justru akan
-- menghasilkan timestamp tanpa zona, jadi dijaga pemeriksaan tipe.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items'
      and column_name = 'created_at' and data_type = 'timestamp without time zone'
  ) then
    alter table public.order_items
      alter column created_at type timestamptz using created_at at time zone 'UTC';
  end if;
end $$;

alter table public.order_items alter column created_at set default now();

-- === 4. Setiap item wajib milik sebuah pesanan ===
alter table public.order_items alter column order_id set not null;

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20260622100100_init_order_items', 'dicatat 7 Okt 2026 — diselaraskan oleh 20261007120000'),
--       ('20261007120000_rapikan_order_items', 'FK ganda dibuang, FK eksplisit, tipe integer/timestamptz')
--     on conflict (version) do nothing
--     returning version;
--
-- === SQL PEMBALIK (jalankan HANYA bila perlu mengembalikan) ===
--
--     alter table public.order_items alter column order_id drop not null;
--     alter table public.order_items alter column created_at drop default;
--     alter table public.order_items
--       alter column created_at type timestamp without time zone using created_at at time zone 'UTC',
--       alter column price_at_purchase type numeric using price_at_purchase::numeric;
--     -- FK ganda TIDAK dikembalikan: keduanya identik dengan FK yang dipertahankan.
--     -- FK eksplisit RESTRICT boleh dibiarkan: perilakunya sama dengan NO ACTION sebelumnya.
--     delete from public.schema_migrations
--       where version in ('20260622100100_init_order_items', '20261007120000_rapikan_order_items');
