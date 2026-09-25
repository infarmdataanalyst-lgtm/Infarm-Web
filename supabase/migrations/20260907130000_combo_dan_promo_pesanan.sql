-- 20260907130000_combo_dan_promo_pesanan.sql
-- Menyalakan promo di pesanan + membuat penjualan combo bisa dilaporkan.
--
-- LATAR BELAKANG
-- Sampai sekarang hanya promo bertipe free_product yang benar-benar sampai ke pesanan.
-- free_shipping, discount_nominal, dan discount_percent hanya hidup sebagai tampilan keranjang:
-- keranjang mengurangi totalnya sendiri, checkout membuang pengurangan itu, dan server memaku
-- discount = 0. Akibatnya pembeli melihat satu angka lalu ditagih angka lain.
-- Combo bernasib serupa: comboId tak pernah diserialkan ke RPC, jadi identitas paket hilang dan
-- tak ada cara mengetahui berapa paket terjual.
--
-- IDEMPOTEN: seluruh pernyataan memakai "if not exists" / "create or replace".

-- === A. order_items: dari paket mana baris ini berasal ===
--
-- SENGAJA TANPA FOREIGN KEY, mengikuti kolom product_id di tabel yang sama (yang juga bare uuid),
-- BUKAN mengikuti promotion_id. promotion_id memakai FK berperilaku NO ACTION, sehingga menghapus
-- promo yang pernah terpakai DIBLOKIR database. Kalau combo diperlakukan sama, admin tak akan
-- pernah bisa menghapus paket lama. Bare uuid membuat riwayat penjualan tetap utuh meski paketnya
-- sudah dihapus, dan riwayat penjualan justru hal yang paling ingin dipertahankan.
alter table public.order_items
  add column if not exists combo_id uuid;

comment on column public.order_items.combo_id is
  'Paket asal baris ini (product_combos.id). Snapshot tanpa FK, sengaja, agar combo tetap bisa dihapus tanpa menghapus riwayat penjualannya.';

create index if not exists order_items_combo_id_idx
  on public.order_items (combo_id)
  where combo_id is not null;

-- === B. orders: angka promo ===
alter table public.orders
  add column if not exists diskon integer not null default 0,
  add column if not exists ongkos_kirim_ditanggung integer not null default 0,
  add column if not exists promo_terpakai jsonb not null default '[]'::jsonb;

-- PERHATIAN: ongkos_kirim TETAP berisi tarif Mengantar yang SEBENARNYA. Jangan pernah dinolkan
-- saat promo gratis ongkir berlaku. Kolom itu ada supaya tagihan kurir bisa direkonsiliasi;
-- menolkannya berarti kehilangan angka yang benar-benar dibayarkan toko ke Mengantar. Subsidinya
-- dicatat terpisah di ongkos_kirim_ditanggung.
comment on column public.orders.diskon is
  'Potongan harga barang dari promo (rupiah). jumlah_total = subtotal + ongkos_kirim - diskon - ongkos_kirim_ditanggung.';
comment on column public.orders.ongkos_kirim_ditanggung is
  'Ongkir yang disubsidi promo free_shipping. ongkos_kirim tetap tarif asli untuk rekonsiliasi Mengantar.';
comment on column public.orders.promo_terpakai is
  'Snapshot promo yang diterapkan. Snapshot, bukan relasi: menghapus promo tak boleh menghapus jejak pesanan.';

-- === C. Seed pengaturan plafon diskon ===
insert into public.store_settings (key, value)
values ('max_discount_percent', '50')
on conflict (key) do nothing;

-- === D. RPC: terima combo_id per item + tiga angka promo ===
--
-- Signature BERTAMBAH tiga parameter ber-default, jadi pemanggil lama tetap sah dan tak ada
-- overload ambigu. Karena itu fungsi lama TIDAK di-drop.
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
      select stok, nama_varian into v_stock, v_name
      from public.product_variants where id = v_variant_id for update;
      if found then
        if v_stock < v_qty then
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'varian');
        end if;
        update public.product_variants set stok = stok - v_qty where id = v_variant_id;
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

-- CATATAN pesan galat: exception di atas SENGAJA hanya memuat NAMA produk
-- (INSUFFICIENT_STOCK:<nama>), tanpa sisa stok. Versi sebelumnya mengirim
-- INSUFFICIENT_STOCK:<nama>:<sisa> sedangkan pengurainya di src/lib/mock-db/orders.ts memotong
-- pada token pertama saja, sehingga pembeli melihat pesan "Stok produk Bayam:3 tidak mencukupi".
