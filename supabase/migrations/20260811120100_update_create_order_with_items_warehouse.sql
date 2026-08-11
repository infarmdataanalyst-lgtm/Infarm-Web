-- supabase/migrations/20260811120100_update_create_order_with_items_warehouse.sql
-- Update RPC create_order_with_items agar sadar GUDANG.
-- Jalankan SETELAH 20260811120000_init_warehouses.sql.
--
-- Perubahan:
--   1. Param baru p_warehouse_id (uuid, boleh null) → disimpan ke orders.warehouse_id.
--   2. Stok dikurangi dari public.product_stock_per_warehouse (sumber kebenaran baru) bila
--      barisnya ada, DAN tetap di-mirror ke kolom lama (products.stock / product_variants.stok)
--      supaya semua pembaca lama tetap akurat.
--   3. Bila baris per-gudang TIDAK ada (mis. produk dibuat sebelum migration & belum di-backfill),
--      fungsi jatuh ke perilaku lama: cek & kurangi kolom stok lama. Fail-safe, tidak pernah
--      menolak pesanan hanya karena data gudang belum lengkap.
--
-- Signature BERUBAH (satu param tambahan). Fungsi lama di-drop agar tidak ada overload ambigu
-- yang bisa membuat PostgREST memilih versi salah.

drop function if exists public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb
);

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
  p_warehouse_id     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id     uuid;
  v_warehouse_id uuid;
  v_item         jsonb;
  v_pid          uuid;
  v_qty          integer;
  v_price        integer;
  v_stock        integer;
  v_name         text;
  v_is_promo     boolean;
  v_promo_id     uuid;
  v_variant_id   uuid;
  v_row_id       uuid;
begin
  -- Gudang: pakai yang dikirim aplikasi; bila null, jatuh ke gudang default (mode single).
  v_warehouse_id := p_warehouse_id;
  if v_warehouse_id is null then
    select id into v_warehouse_id from public.warehouses where is_default limit 1;
  end if;

  -- 1. Insert header order
  insert into public.orders (
    nomor_invoice, email, no_telepon, nama_customer, jumlah_total,
    shipping_address, provinsi, kota, kecamatan, kelurahan, kodepos,
    nama_ekspedisi, jenis_layanan, no_tracking, status_pembayaran,
    id_transaksi, order_status, destination_id, warehouse_id
  ) values (
    p_nomor_invoice, p_email, p_no_telepon, p_nama_customer, p_jumlah_total,
    p_shipping_address, p_provinsi, p_kota, p_kecamatan, p_kelurahan, p_kodepos,
    p_nama_ekspedisi, p_jenis_layanan, null, p_status_pembayaran,
    null, p_order_status, p_destination_id, v_warehouse_id
  ) returning id into v_order_id;

  -- 2. Loop item
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := (v_item->>'quantity')::integer;
    v_price := (v_item->>'price_at_purchase')::integer;
    v_is_promo := coalesce((v_item->>'is_promo_item')::boolean, false);
    begin v_promo_id   := (v_item->>'promotion_id')::uuid; exception when others then v_promo_id := null; end;
    begin v_variant_id := (v_item->>'variant_id')::uuid;   exception when others then v_variant_id := null; end;
    begin v_pid        := (v_item->>'product_id')::uuid;   exception when others then v_pid := null; end;

    -- 2a. Stok per gudang (sumber kebenaran baru). Baris dikunci FOR UPDATE agar dua checkout
    --     bersamaan tidak sama-sama lolos pengecekan stok.
    v_row_id := null;
    if v_warehouse_id is not null and v_pid is not null then
      if v_variant_id is not null then
        select id, stok into v_row_id, v_stock
        from public.product_stock_per_warehouse
        where product_id = v_pid and variant_id = v_variant_id and warehouse_id = v_warehouse_id
        for update;
      else
        select id, stok into v_row_id, v_stock
        from public.product_stock_per_warehouse
        where product_id = v_pid and variant_id is null and warehouse_id = v_warehouse_id
        for update;
      end if;

      if v_row_id is not null then
        if v_stock < v_qty then
          -- Nama produk/varian untuk pesan error yang bisa dibaca pembeli
          if v_variant_id is not null then
            select nama_varian into v_name from public.product_variants where id = v_variant_id;
          else
            select name into v_name from public.products where id = v_pid;
          end if;
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
        end if;
        update public.product_stock_per_warehouse
          set stok = stok - v_qty
          where id = v_row_id;
      end if;
    end if;

    -- 2b. Mirror ke kolom stok lama. Bila baris per-gudang tidak ada (v_row_id null), blok ini
    --     sekaligus menjadi jalur pengecekan stok (perilaku persis seperti sebelum migration).
    if v_variant_id is not null then
      select stok, nama_varian into v_stock, v_name
      from public.product_variants where id = v_variant_id for update;
      if found then
        if v_row_id is null and v_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'varian');
        end if;
        update public.product_variants
          set stok = greatest(0, stok - v_qty)
          where id = v_variant_id;
      end if;
    elsif v_pid is not null then
      select stock, name into v_stock, v_name
      from public.products where id = v_pid for update;
      if found then
        if v_row_id is null and v_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
        end if;
        update public.products
          set stock = greatest(0, stock - v_qty)
          where id = v_pid;
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id
    ) values (
      v_order_id, v_pid, v_qty, v_price, v_is_promo, v_promo_id, v_variant_id
    );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, uuid
) to service_role;
