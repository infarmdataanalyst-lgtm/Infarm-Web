-- supabase/migrations/20260702120000_create_order_with_items.sql
-- Fungsi RPC transaksi atomik untuk checkout: insert orders + order_items + kurangi stok
-- dalam SATU transaksi. Bila stok salah satu produk kurang → seluruh transaksi rollback.
-- Dipanggil dari src/lib/mock-db/orders.ts (saveOrder) via supabase.rpc('create_order_with_items').
--
-- Asumsi skema (sesuai perubahan manual di Dashboard):
--   orders(nomor_invoice, email, no_telepon, nama_customer, jumlah_total, shipping_address,
--          provinsi, kota, kecamatan, kelurahan, kodepos, nama_ekspedisi, jenis_layanan,
--          no_tracking, status_pembayaran, id_transaksi, order_status, destination_id, created_at)
--   order_items(id, order_id → orders.id, product_id, quantity, price_at_purchase, created_at)
--   products.stock (integer)  ← nama kolom stok = 'stock' (bukan 'stok')

-- Nomor invoice wajib unik (dipakai retry saat tabrakan nomor acak di app)
create unique index if not exists orders_nomor_invoice_key on public.orders (nomor_invoice);

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
  p_items            jsonb   -- [{ "product_id", "quantity", "price_at_purchase" }, ...]
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

    -- product_id bisa UUID (produk OMS) atau id dummy non-UUID → tangani aman
    begin
      v_pid := (v_item->>'product_id')::uuid;
    exception when others then
      v_pid := null;
    end;

    -- Cek & kurangi stok hanya untuk produk yang ADA di tabel products
    if v_pid is not null then
      select stock, name into v_stock, v_name
      from public.products where id = v_pid for update;

      if found then
        if v_stock < v_qty then
          -- Rollback otomatis; app menangkap pesan ini → "Stok produk {nama} tidak mencukupi"
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'produk');
        end if;
        update public.products set stock = stock - v_qty where id = v_pid;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, quantity, price_at_purchase)
    values (v_order_id, v_pid, v_qty, v_price);
  end loop;

  return v_order_id;
end;
$$;

-- service_role (dipakai app) boleh eksekusi fungsi ini
grant execute on function public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb
) to service_role;
