-- supabase/migrations/20260928120000_promotions_kuota.sql
-- Kuota promo: batas pemakaian OPSIONAL per promo (mis. "gratis ongkir untuk 10 pesanan pertama").
--
-- ATURAN
--   - promotions.usage_limit NULL  = tanpa batas (semua promo lama tetap begini).
--   - promotions.usage_count       = jumlah pesanan yang sedang memakai promo itu.
--   - Kuota DIPOTONG saat pesanan dibuat (di dalam create_order_with_items, satu transaksi dengan
--     pemotongan stok) dan DIKEMBALIKAN saat pesanan batal/kedaluwarsa (release_promo_quota).
--     Tanpa pengembalian, pembeli yang checkout lalu tak membayar bisa menghabiskan kuota.
--   - Rebutan kuota terakhir dijaga DATABASE: baris promo dikunci (for update) sebelum dicek,
--     sama seperti stok yang tak bisa minus. Dua checkout bersamaan untuk kuota terakhir → hanya
--     satu yang lolos, yang lain menerima 'PROMO_QUOTA_EXHAUSTED:<nama promo>'.
--
-- AMAN DIJALANKAN SEBELUM KODE APLIKASINYA DI-MERGE
--   create_order_with_items diganti dengan tanda tangan IDENTIK (22 parameter) — kode lama tetap
--   memanggilnya seperti biasa. Kuota hanya bisa menolak pesanan bila usage_limit terisi, dan
--   isian itu baru ada di formulir OMS setelah kode barunya di-merge. Sebelum itu satu-satunya
--   efeknya: usage_count ikut bertambah untuk setiap promo yang dipakai.
--
-- IDEMPOTEN: aman dijalankan ulang (add column if not exists, drop/add constraint, isi ulang
-- usage_count dari pesanan yang ada, create or replace).
--
-- JALANKAN DI: Supabase PREVIEW dulu (uji), lalu PRODUKSI tepat sebelum/sesudah PR di-merge.

-- === 1. Kolom ===

alter table public.promotions
  add column if not exists usage_limit integer,
  add column if not exists usage_count integer not null default 0;

alter table public.promotions drop constraint if exists promotions_usage_limit_positive;
alter table public.promotions
  add constraint promotions_usage_limit_positive check (usage_limit is null or usage_limit >= 1);

alter table public.promotions drop constraint if exists promotions_usage_count_nonneg;
alter table public.promotions
  add constraint promotions_usage_count_nonneg check (usage_count >= 0);

-- Sengaja TIDAK ada constraint usage_count <= usage_limit: admin boleh menurunkan batas di bawah
-- pemakaian yang sudah terjadi (mis. menghentikan promo lebih cepat). Penegakannya di RPC — pesanan
-- baru ditolak selama usage_count >= usage_limit.

-- Penanda "kuota promo pesanan ini sudah dikembalikan". Membuat release_promo_quota idempoten:
-- webhook Xendit dan penyapu terjadwal bisa sama-sama membatalkan pesanan yang sama.
alter table public.orders
  add column if not exists promo_quota_released_at timestamptz;

-- === 2. Isi awal dari pesanan yang sudah ada ===
--
-- Pemakaian = pesanan yang BELUM batal dan memakai promo itu. Sumbernya dua: promo_terpakai
-- (diskon, gratis ongkir, dan hadiah sejak PR #37) dan order_items.promotion_id (hadiah di pesanan
-- lama sebelum PR #37). distinct order_id supaya pesanan yang tercatat di keduanya dihitung sekali.

update public.promotions set usage_count = 0;

with pemakaian as (
  select o.id as order_id, (x->>'id')::uuid as promo_id
  from public.orders o, jsonb_array_elements(coalesce(o.promo_terpakai, '[]'::jsonb)) x
  where o.order_status <> 'CANCELLED'
    and (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union
  select oi.order_id, oi.promotion_id
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.promotion_id is not null
    and o.order_status <> 'CANCELLED'
)
update public.promotions p
set usage_count = hitung.n
from (
  select promo_id, count(distinct order_id)::integer as n
  from pemakaian
  group by promo_id
) hitung
where p.id = hitung.promo_id;

-- Pesanan yang SUDAH batal tak ikut dihitung di atas → tandai kuotanya sudah dikembalikan, supaya
-- pembatalan ulang (atau sapuan terjadwal) tak mengurangi usage_count di bawah angka yang benar.
update public.orders
set promo_quota_released_at = coalesce(promo_quota_released_at, now())
where order_status = 'CANCELLED';

-- === 3. create_order_with_items: potong kuota di transaksi yang sama dengan stok ===
--
-- Salinan PERSIS dari 20260922110000_rpc_varian_stok_per_gudang.sql, ditambah SATU blok setelah
-- insert orders (ditandai "KUOTA PROMO"). Tanda tangan 22 parameter identik → create or replace
-- mengganti fungsi yang ada, tak membuat overload baru.

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
  v_kuota_id    uuid;
  v_kuota_nama  text;
  v_kuota_batas integer;
  v_kuota_pakai integer;
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

  -- === KUOTA PROMO ===
  -- Setiap promo yang dipakai pesanan ini: kunci barisnya, tolak bila kuotanya penuh, lalu tambah
  -- pemakaiannya. Diurutkan menurut id supaya dua transaksi yang memakai promo yang sama selalu
  -- mengunci dengan urutan sama (tak bisa saling kunci/deadlock). Gagal di sini → seluruh
  -- transaksi (termasuk insert orders di atas) dibatalkan.
  for v_kuota_id in
    select distinct (x->>'id')::uuid
    from jsonb_array_elements(coalesce(p_promo_terpakai, '[]'::jsonb)) x
    where (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by 1
  loop
    select name, usage_limit, usage_count
      into v_kuota_nama, v_kuota_batas, v_kuota_pakai
    from public.promotions
    where id = v_kuota_id
    for update;

    if not found then
      continue; -- promo sudah dihapus admin: tak ada kuota yang bisa dijaga
    end if;

    if v_kuota_batas is not null and v_kuota_pakai >= v_kuota_batas then
      raise exception 'PROMO_QUOTA_EXHAUSTED:%', coalesce(v_kuota_nama, 'promo');
    end if;

    update public.promotions set usage_count = usage_count + 1 where id = v_kuota_id;
  end loop;

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

-- === 4. release_promo_quota: kembalikan kuota saat pesanan batal ===
--
-- Idempoten: hanya pemanggilan PERTAMA per pesanan yang mengurangi usage_count (ditandai lewat
-- orders.promo_quota_released_at). Dipanggil aplikasi di keempat jalur pembatalan, tepat di
-- sebelah pengembalian stok. Mengembalikan jumlah promo yang kuotanya dikembalikan.

create or replace function public.release_promo_quota(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_promo_terpakai jsonb;
  v_id uuid;
  v_n  integer := 0;
begin
  update public.orders
  set promo_quota_released_at = now()
  where id = p_order_id and promo_quota_released_at is null
  returning promo_terpakai into v_promo_terpakai;

  if not found then
    return 0; -- sudah pernah dikembalikan, atau pesanan tak ada
  end if;

  for v_id in
    select distinct pid from (
      select (x->>'id')::uuid as pid
      from jsonb_array_elements(coalesce(v_promo_terpakai, '[]'::jsonb)) x
      where (x->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      union
      select promotion_id from public.order_items
      where order_id = p_order_id and promotion_id is not null
    ) s
    order by 1
  loop
    update public.promotions set usage_count = greatest(0, usage_count - 1) where id = v_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

-- Sama dengan fungsi lain (20260914130000): hanya server (service_role) yang boleh memanggil.
revoke all on function public.release_promo_quota(uuid) from public, anon, authenticated;
grant execute on function public.release_promo_quota(uuid) to service_role;

-- =================================================================================================
-- VERIFIKASI SESUDAH MENJALANKAN
-- =================================================================================================
--
-- a. Kolom & isi awal pemakaian:
--    select name, usage_limit, usage_count from public.promotions order by created_at desc;
--
-- b. Tetap DUA overload create_order_with_items (19 & 22), bukan tiga:
--    select p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'create_order_with_items' order by 1;
--
-- c. Blok kuota terpasang:
--    select position('PROMO_QUOTA_EXHAUSTED' in pg_get_functiondef(p.oid)) > 0 as kuota_terpasang
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'create_order_with_items' and p.pronargs = 22;
