-- 20260922110000_rpc_varian_stok_per_gudang.sql
-- Mengembalikan penanganan stok PER GUDANG untuk produk bervarian di RPC checkout.
--
-- LATAR BELAKANG
-- Migration 20260907130000 menulis ulang create_order_with_items menjadi 22 parameter (untuk
-- combo & promo). Saat penulisan ulang itu, cabang varian ikut disederhanakan dan kehilangan
-- penanganan per gudang yang sudah benar di versi 19 parameter (20260811120100:92-119):
--   - checkout varian hanya mengunci & mengurangi product_variants.stok (AGREGAT lintas gudang);
--   - cabang per gudang ada di bawah `elsif`, jadi tak pernah dijalankan untuk varian;
--   - akibatnya product_stock_per_warehouse untuk varian tidak pernah berkurang saat terjual.
-- Dua checkout varian bersamaan ke gudang yang sama bisa sama-sama lolos selama agregatnya cukup,
-- walau gudang itu sendiri kehabisan.
--
-- KENAPA INI MEMPERBURUK DIRI SENDIRI SEIRING WAKTU
-- Jalur pembatalan (restoreStock -> returnStockToWarehouse) MENGEMBALIKAN stok varian ke baris per
-- gudang. Jadi baris itu tak pernah dikurangi saat terjual, tapi bertambah tiap pesanan batal.
-- Setiap pembatalan pesanan varian sejak 7 Sep menambah stok hantu di gudang.
--
-- Terbukti di database produksi 22 Sep 2026: dua overload hidup berdampingan (19 & 22 parameter),
-- dan aplikasi memanggil yang 22 karena saveOrder selalu mengirim p_diskon/p_ongkos_kirim_ditanggung/
-- p_promo_terpakai. Lihat Notion E2E testing "Dua overload create_order_with_items hidup berdampingan".
--
-- YANG DIUBAH: HANYA cabang `if v_variant_id is not null`. Sekarang meniru cabang produk tepat di
-- bawahnya — kunci baris per gudang dulu, jatuh ke kolom stok lama bila barisnya tak ada. Seluruh
-- bagian lain disalin apa adanya dari 20260907130000, termasuk urutan insert dan pesan galat.
--
-- PENTING — JALANKAN PEMERIKSAAN SELISIH DULU (lihat blok di akhir file)
-- Setelah migration ini, gerbang stok varian pindah dari angka agregat ke angka per gudang. Kalau
-- angka per gudang sudah melenceng akibat bug di atas, migration ini akan mulai MEMERCAYAI angka
-- yang salah. Periksa dan rekonsiliasi dulu sebelum menjalankan blok `create or replace` di bawah.
--
-- Overload 19 parameter SENGAJA TIDAK di-drop: jalur fallback berjenjang di saveOrder
-- (src/lib/mock-db/orders.ts) jatuh ke sana bila panggilan 22 parameter gagal, dan overload itu
-- memang sudah menangani varian dengan benar.
--
-- IDEMPOTEN: create or replace dengan tanda tangan identik (22 parameter) mengganti fungsi yang ada,
-- tidak membuat overload baru. Hak akses fungsi ikut dipertahankan Postgres.

create or replace function public.create_order_with_items(
  p_nomor_invoice    text,
  p_email            text,
  p_no_telepon       text,
  p_nama_customer    text,
  p_jumlah_total     integer,
  p_shipping_address text,
  p_provinsi         text,
  p_kota             text,
  p_kecamatan        text,
  p_kelurahan        text,
  p_kodepos          text,
  p_nama_ekspedisi   text,
  p_jenis_layanan    text,
  p_status_pembayaran text,
  p_order_status     text,
  p_destination_id   text,
  p_items            jsonb,
  p_warehouse_id     uuid    default null,
  p_ongkos_kirim     integer default null,
  p_diskon           integer default 0,
  p_ongkos_kirim_ditanggung integer default 0,
  p_promo_terpakai   jsonb   default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order_id   uuid;
  v_item       jsonb;
  v_pid        uuid;
  v_qty        integer;
  v_price      integer;
  v_stock      integer;
  v_name       text;
  v_is_promo   boolean;
  v_promo_id   uuid;
  v_variant_id uuid;
  v_combo_id   uuid;
  v_wh_stock   integer;
  v_wh_row_id  uuid;
begin
  insert into public.orders (
    nomor_invoice, email, no_telepon, nama_customer, jumlah_total,
    shipping_address, provinsi, kota, kecamatan, kelurahan, kodepos,
    nama_ekspedisi, jenis_layanan, no_tracking, status_pembayaran,
    id_transaksi, order_status, destination_id, warehouse_id, ongkos_kirim,
    diskon, ongkos_kirim_ditanggung, promo_terpakai
  ) values (
    p_nomor_invoice, p_email, p_no_telepon, p_nama_customer, p_jumlah_total,
    p_shipping_address, p_provinsi, p_kota, p_kecamatan, p_kelurahan, p_kodepos,
    p_nama_ekspedisi, p_jenis_layanan, null, p_status_pembayaran,
    null, p_order_status, p_destination_id, p_warehouse_id, p_ongkos_kirim,
    coalesce(p_diskon, 0), coalesce(p_ongkos_kirim_ditanggung, 0),
    coalesce(p_promo_terpakai, '[]'::jsonb)
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := (v_item->>'quantity')::integer;
    v_price := (v_item->>'price_at_purchase')::integer;
    v_is_promo := coalesce((v_item->>'is_promo_item')::boolean, false);
    begin v_promo_id   := (v_item->>'promotion_id')::uuid; exception when others then v_promo_id := null; end;
    begin v_variant_id := (v_item->>'variant_id')::uuid;   exception when others then v_variant_id := null; end;
    begin v_pid        := (v_item->>'product_id')::uuid;   exception when others then v_pid := null; end;
    begin v_combo_id   := (v_item->>'combo_id')::uuid;     exception when others then v_combo_id := null; end;

    if v_variant_id is not null then
      select nama_varian into v_name from public.product_variants where id = v_variant_id;

      -- Stok per gudang bila barisnya ada; kalau tidak, jatuh ke kolom stok varian lama (fail-safe).
      -- Sama dengan cabang produk di bawah, hanya kuncinya ditambah variant_id. saveOrder selalu
      -- mengirim product_id untuk item varian, jadi v_pid terisi di sini.
      if p_warehouse_id is not null and v_pid is not null then
        select id, stok into v_wh_row_id, v_wh_stock
        from public.product_stock_per_warehouse
        where product_id = v_pid and variant_id = v_variant_id and warehouse_id = p_warehouse_id
        for update;
      else
        v_wh_row_id := null;
      end if;

      if v_wh_row_id is not null then
        if v_wh_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'varian');
        end if;
        update public.product_stock_per_warehouse set stok = stok - v_qty where id = v_wh_row_id;
        -- Mirror ke kolom lama supaya seluruh pembaca lama tetap akurat.
        update public.product_variants set stok = greatest(0, stok - v_qty) where id = v_variant_id;
      else
        select stok into v_stock from public.product_variants where id = v_variant_id for update;
        if found then
          if v_stock < v_qty then
            raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'varian');
          end if;
          update public.product_variants set stok = stok - v_qty where id = v_variant_id;
        end if;
      end if;
    elsif v_pid is not null then
      select name into v_name from public.products where id = v_pid;

      -- Stok per gudang bila barisnya ada; kalau tidak, jatuh ke kolom stok lama (fail-safe).
      if p_warehouse_id is not null then
        select id, stok into v_wh_row_id, v_wh_stock
        from public.product_stock_per_warehouse
        where product_id = v_pid and warehouse_id = p_warehouse_id and variant_id is null
        for update;
      else
        v_wh_row_id := null;
      end if;

      if v_wh_row_id is not null then
        if v_wh_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
        end if;
        update public.product_stock_per_warehouse set stok = stok - v_qty where id = v_wh_row_id;
        -- Mirror ke kolom lama supaya seluruh pembaca lama tetap akurat.
        update public.products set stock = greatest(0, stock - v_qty) where id = v_pid;
      else
        select stock into v_stock from public.products where id = v_pid for update;
        if found then
          if v_stock < v_qty then
            raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
          end if;
          update public.products set stock = stock - v_qty where id = v_pid;
        end if;
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, quantity, price_at_purchase,
      is_promo_item, promotion_id, variant_id, combo_id
    ) values (
      v_order_id, v_pid, v_qty, v_price,
      v_is_promo, v_promo_id, v_variant_id, v_combo_id
    );
  end loop;

  return v_order_id;
end;
$fn$;

grant execute on function public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, uuid, integer, integer, integer, jsonb
) to service_role;

-- =================================================================================================
-- PEMERIKSAAN SEBELUM MENJALANKAN (salin & jalankan TERPISAH di SQL Editor, SEBELUM blok di atas)
-- =================================================================================================
--
-- 1. Adakah varian yang angka per gudangnya melenceng dari angka agregat?
--
--    select v.id as variant_id, p.name as produk, v.nama_varian,
--           v.stok as stok_agregat,
--           count(s.id) as jml_baris_gudang,
--           coalesce(sum(s.stok), 0) as jumlah_per_gudang,
--           coalesce(sum(s.stok), 0) - v.stok as selisih
--    from public.product_variants v
--    join public.products p on p.id = v.product_id
--    left join public.product_stock_per_warehouse s on s.variant_id = v.id
--    group by v.id, p.name, v.nama_varian, v.stok
--    having coalesce(sum(s.stok), 0) <> v.stok
--    order by abs(coalesce(sum(s.stok), 0) - v.stok) desc;
--
--    Cara membaca:
--    - Kosong                     -> aman, jalankan migration.
--    - jml_baris_gudang = 0       -> BUKAN drift. Varian ini tak punya baris gudang sama sekali, jadi
--                                    setelah migration tetap memakai jalur cadangan (stok agregat).
--                                    Tidak terdampak perpindahan gerbang.
--    - jml_baris_gudang > 0 DAN   -> drift sungguhan. Gerbang baru akan membaca angka per gudang yang
--      selisih bukan 0              salah. Rekonsiliasi dulu, jangan jalankan migration.
--      Selisih POSITIF (per gudang > agregat) cocok dengan pola bug: pembatalan menambah baris gudang
--      yang tak pernah dikurangi saat terjual.
--
-- 2. Adakah pesanan varian sejak overload 22 parameter hidup? Menentukan apakah drift mungkin ada.
--
--    select count(*) as baris_varian, min(o.created_at) as pertama, max(o.created_at) as terakhir
--    from public.order_items oi
--    join public.orders o on o.id = oi.order_id
--    where oi.variant_id is not null
--      and o.created_at >= '2026-09-07';
--
-- =================================================================================================
-- VERIFIKASI SESUDAH MENJALANKAN
-- =================================================================================================
--
-- Tetap DUA overload (19 & 22), bukan tiga. Kalau muncul tiga, tanda tangannya meleset.
--
--    select p.pronargs as jml_param
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'create_order_with_items'
--    order by p.pronargs;
--
-- Cabang varian kini menyentuh stok per gudang:
--
--    select position('variant_id = v_variant_id and warehouse_id = p_warehouse_id'
--                    in pg_get_functiondef(p.oid)) > 0 as varian_per_gudang
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'create_order_with_items' and p.pronargs = 22;
