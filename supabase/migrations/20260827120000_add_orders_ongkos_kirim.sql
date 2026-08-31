-- supabase/migrations/20260827120000_add_orders_ongkos_kirim.sql
-- Simpan ONGKOS KIRIM sebagai kolom tersendiri di tabel orders.
--
-- ── Masalah yang ditutup ──
-- `orders.jumlah_total` hanya menyimpan hasil akhir (subtotal + ongkir − diskon). Ongkirnya sendiri
-- tak pernah tercatat. Hari ini ia masih bisa dihitung mundur — diskon selalu 0, jadi
-- `ongkir = jumlah_total − Σ(order_items.price_at_purchase × quantity)`. Begitu wiring promo→order
-- selesai, persamaan itu punya DUA variabel tak diketahui dan ongkir hilang permanen.
--
-- Yang tak bisa dijawab tanpa kolom ini, bahkan sekarang:
--   * "Bulan ini kita kutip ongkir Rp X, ditagih Mengantar Rp Y — selisihnya berapa?"
--   * "Pesanan mana saja yang pernah kena celah shippingCost:0 sebelum verifikasi dipasang?"
--   * Rincian item ke Xendit tak bisa dikirim, karena jumlah item ≠ `amount` (lihat catatan di
--     src/lib/xendit/invoice.ts).
--
-- ── Kenapa pesanan lama dibiarkan NULL ──
-- NULL = "ongkirnya memang tak pernah dicatat", dan itu jujur. Mengisinya dengan hasil hitung
-- mundur membuat angka TURUNAN tak bisa dibedakan dari angka yang benar-benar tercatat — enam bulan
-- lagi tak ada yang ingat mana yang mana. Perintah backfill-nya disediakan di bawah, dinonaktifkan;
-- jalankan hanya bila kamu sadar konsekuensinya.
--
-- ── Yang SENGAJA tidak ikut di migration ini ──
-- Kolom `diskon`. Ia pasangan alami kolom ini (tanpa keduanya persamaan tetap timpang begitu promo
-- aktif), tapi diminta terpisah. Selama diskon belum di-wire, `ongkos_kirim` sendirian sudah cukup:
-- subtotal + ongkir = jumlah_total, tak ada yang ambigu.

-- === 1. Kolom ===

alter table public.orders
  add column if not exists ongkos_kirim integer;

comment on column public.orders.ongkos_kirim is
  'Ongkos kirim (rupiah bulat) yang DITAGIHKAN ke pembeli, hasil verifikasi server terhadap tarif '
  'Mengantar. NULL = pesanan dibuat sebelum kolom ini ada — bukan berarti gratis ongkir.';

-- Tak boleh negatif. Nol SAH: promo gratis ongkir kelak akan memakainya, dan itu beda makna dari NULL.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_ongkos_kirim_check') then
    alter table public.orders
      add constraint orders_ongkos_kirim_check
      check (ongkos_kirim is null or ongkos_kirim >= 0);
  end if;
end $$;

-- === 2. RPC create_order_with_items: satu parameter baru ===
--
-- Ongkir ditulis DI DALAM RPC, bukan lewat UPDATE menyusul. Alasannya sama dengan seluruh isi
-- fungsi ini: pesanan, itemnya, dan pemotongan stok harus jadi satu transaksi. UPDATE terpisah yang
-- gagal akan meninggalkan pesanan ber-ongkir NULL yang tak bisa dibedakan dari pesanan lama.
--
-- Fungsi lama di-drop lebih dulu agar tidak ada overload ambigu — PostgREST bisa memilih versi yang
-- salah dan parameter baru diabaikan diam-diam.

drop function if exists public.create_order_with_items(
  text, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, uuid
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
  p_warehouse_id     uuid default null,
  p_ongkos_kirim     integer default null
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
    id_transaksi, order_status, destination_id, warehouse_id, ongkos_kirim
  ) values (
    p_nomor_invoice, p_email, p_no_telepon, p_nama_customer, p_jumlah_total,
    p_shipping_address, p_provinsi, p_kota, p_kecamatan, p_kelurahan, p_kodepos,
    p_nama_ekspedisi, p_jenis_layanan, null, p_status_pembayaran,
    null, p_order_status, p_destination_id, v_warehouse_id, p_ongkos_kirim
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
          select nama into v_name from public.products where id = v_pid;
          raise exception 'INSUFFICIENT_STOCK:%:%', coalesce(v_name, v_pid::text), v_stock;
        end if;

        update public.product_stock_per_warehouse
        set stok = stok - v_qty
        where id = v_row_id;

        -- Mirror ke kolom stok lama supaya pembaca yang belum sadar gudang tetap akurat.
        if v_variant_id is not null then
          update public.product_variants set stok = greatest(0, stok - v_qty) where id = v_variant_id;
        else
          update public.products set stock = greatest(0, stock - v_qty) where id = v_pid;
        end if;
      end if;
    end if;

    -- 2b. Fallback: baris per-gudang belum ada → perilaku lama (cek & kurangi kolom stok lama).
    if v_row_id is null and v_pid is not null then
      if v_variant_id is not null then
        select stok, nama_varian into v_stock, v_name
        from public.product_variants where id = v_variant_id for update;
        if found then
          if v_stock < v_qty then
            raise exception 'INSUFFICIENT_STOCK:%:%', coalesce(v_name, v_variant_id::text), v_stock;
          end if;
          update public.product_variants set stok = stok - v_qty where id = v_variant_id;
        end if;
      else
        select stock, nama into v_stock, v_name
        from public.products where id = v_pid for update;
        if found then
          if v_stock < v_qty then
            raise exception 'INSUFFICIENT_STOCK:%:%', coalesce(v_name, v_pid::text), v_stock;
          end if;
          update public.products set stock = stock - v_qty where id = v_pid;
        end if;
      end if;
    end if;

    -- 2c. Baris item
    insert into public.order_items (
      order_id, product_id, quantity, price_at_purchase, is_promo_item, promotion_id, variant_id
    ) values (
      v_order_id, v_pid, v_qty, v_price, v_is_promo, v_promo_id, v_variant_id
    );
  end loop;

  return v_order_id;
end;
$$;

-- === 3. Backfill pesanan lama — SENGAJA DINONAKTIFKAN ===
--
-- Sah HANYA selama diskon belum pernah dipakai (saat migration ini ditulis: belum). Setelah promo
-- aktif, hasilnya akan salah untuk pesanan berdiskon dan tak ada cara mengetahui mana yang salah.
--
-- Hapus komentar hanya bila kamu memang ingin angka TURUNAN tercampur dengan angka TERCATAT.
--
-- update public.orders o
-- set ongkos_kirim = o.jumlah_total - coalesce((
--   select sum(oi.price_at_purchase * oi.quantity)
--   from public.order_items oi where oi.order_id = o.id
-- ), 0)
-- where o.ongkos_kirim is null;
