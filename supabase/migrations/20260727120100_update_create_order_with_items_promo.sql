-- supabase/migrations/20260727120100_update_create_order_with_items_promo.sql
-- Update RPC create_order_with_items agar ikut menyimpan penanda item promo (produk gratis).
-- Signature TIDAK berubah (tetap satu param jsonb p_items) → grant lama tetap berlaku.
-- Tiap elemen p_items kini boleh punya key opsional:
--   is_promo_item (boolean, default false), promotion_id (uuid, default null).
-- Item promo (produk gratis) tetap MENGURANGI STOK seperti item biasa (barang dikirim fisik),
-- hanya price_at_purchase = 0.
-- Jalankan SETELAH 20260727120000_add_order_items_promo.sql.

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
  p_items            jsonb   -- [{ "product_id","quantity","price_at_purchase","is_promo_item"?,"promotion_id"? }, ...]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
  v_pid      uuid;
  v_qty      integer;
  v_price    integer;
  v_stock    integer;
  v_name     text;
  v_is_promo boolean;
  v_promo_id uuid;
begin
  -- 1. Insert header order (no_tracking & id_transaksi kosong dulu)
  insert into public.orders (
    nomor_invoice, email, no_telepon, nama_customer, jumlah_total,
    shipping_address, provinsi, kota, kecamatan, kelurahan, kodepos,
    nama_ekspedisi, jenis_layanan, no_tracking, status_pembayaran,
    id_transaksi, order_status, destination_id
  ) values (
    p_nomor_invoice, p_email, p_no_telepon, p_nama_customer, p_jumlah_total,
    p_shipping_address, p_provinsi, p_kota, p_kecamatan, p_kelurahan, p_kodepos,
    p_nama_ekspedisi, p_jenis_layanan, null, p_status_pembayaran,
    null, p_order_status, p_destination_id
  ) returning id into v_order_id;

  -- 2. Loop item: cek stok, insert order_items, kurangi stok
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := (v_item->>'quantity')::integer;
    v_price := (v_item->>'price_at_purchase')::integer;
    -- Penanda promo (opsional; default aman bila key tak ada)
    v_is_promo := coalesce((v_item->>'is_promo_item')::boolean, false);
    begin
      v_promo_id := (v_item->>'promotion_id')::uuid;
    exception when others then
      v_promo_id := null;
    end;

    -- product_id bisa UUID (produk OMS) atau id dummy non-UUID → tangani aman
    begin
      v_pid := (v_item->>'product_id')::uuid;
    exception when others then
      v_pid := null;
    end;

    -- Cek & kurangi stok hanya untuk produk yang ADA di tabel products.
    -- Item promo (produk gratis) TETAP mengurangi stok — barang dikirim fisik.
    if v_pid is not null then
      select stock, name into v_stock, v_name
      from public.products where id = v_pid for update;

      if found then
        if v_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
        end if;
        update public.products set stock = stock - v_qty where id = v_pid;
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id
    ) values (
      v_order_id, v_pid, v_qty, v_price, v_is_promo, v_promo_id
    );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb
) to service_role;
