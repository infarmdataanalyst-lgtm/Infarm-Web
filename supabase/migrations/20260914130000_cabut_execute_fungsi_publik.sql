-- supabase/migrations/20260914130000_cabut_execute_fungsi_publik.sql
-- MENCABUT hak anon/authenticated menjalankan fungsi `security definer` milik aplikasi.
--
-- ⚠ INI PERBAIKAN ATAS CELAH YANG IZINNYA SUDAH TERBUKTI TERBUKA.
--
-- Terukur 2026-09-14 lewat has_function_privilege di SQL Editor:
--
--   create_order_with_items (overload 1)  pemilik postgres  anon=true  authenticated=true
--   create_order_with_items (overload 2)  pemilik postgres  anon=true  authenticated=true
--
-- ── Kenapa itu berbahaya ──
-- Anon key ikut terkirim ke SETIAP browser pengunjung. Dengannya siapa pun bisa memanggil
-- POST /rest/v1/rpc/create_order_with_items LANGSUNG, melewati seluruh pagar di
-- /api/orders/create: harga item dihitung ulang dari DB, promo & combo diverifikasi server,
-- ongkir diverifikasi ke Mengantar, minimum pembelian, dan rate limit ORDER_CREATE_IP.
--
-- Fungsinya menerima `p_jumlah_total` MENTAH. Dan /api/payments/invoice menagih Xendit dengan
-- `amount: order.totalAmount` — `orders.jumlah_total` apa adanya (src/lib/xendit/invoice.ts).
-- Rantainya: buat pesanan barang mahal bertotal kecil lewat RPC → bayar lewat halaman pembayaran
-- biasa → webhook menandai LUNAS → booking kurir → barang benar-benar dikirim. Setiap panggilan
-- juga memotong stok, jadi fungsi yang sama bisa dipakai menguras stok sampai toko tak bisa
-- menjual. Rantai ini DISIMPULKAN dari izin yang terukur dan jalur kode yang dibaca — sengaja TIDAK
-- dieksekusi, karena mengujinya berarti membuat pesanan dan tagihan sungguhan.
--
-- ── Akar masalahnya ──
-- PostgreSQL memberi EXECUTE kepada PUBLIC untuk SETIAP fungsi baru secara bawaan, dan anon serta
-- authenticated mewarisi PUBLIC. Seluruh migration fungsi di proyek ini hanya menulis
-- `grant execute ... to service_role` — tak satu pun `revoke ... from public`. Menambah izin
-- untuk service_role tidak mencabut izin bawaan untuk semua orang.
--
-- Komentar di 20260904120000_stok_increment_atomik.sql berbunyi "anon/authenticated SENGAJA
-- tidak diberi execute". Maksudnya benar, tapi tidak memberi BUKAN berarti mencabut — izin
-- bawaannya tetap berlaku.
--
-- ── Dampak ke aplikasi: tidak ada ──
-- Setiap `.rpc(...)` di src/ memakai createAdminClient() (service_role): create_order_with_items di
-- mock-db/orders.ts, adjust_warehouse_stock_atomic di mock-db/warehouses.ts, dan
-- adjust_product_stock_atomic di mock-db/products.ts. EXECUTE untuk service_role diberikan ULANG
-- secara eksplisit di bawah, jadi pencabutan dari PUBLIC tak bisa ikut memutus jalur itu.

-- === 1. Cabut dari PUBLIC/anon/authenticated, beri ulang ke service_role ===
--
-- Lewat perulangan pg_proc, bukan daftar signature tertulis, karena ada DUA overload
-- create_order_with_items di database (versi lama sengaja tak di-drop saat parameter ditambah) dan
-- signature persisnya tak bisa dipastikan dari repo. Menulisnya tangan berarti mengambil risiko
-- satu overload terlewat — dan overload yang terlewat tetap bisa dipanggil.
--
-- adjust_*_stock_atomic ikut disebut walau saat ini TIDAK ADA di database (tidak muncul di daftar
-- fungsi security definer — migration 20260904120000 belum dijalankan). Perulangan tak melakukan
-- apa pun untuk fungsi yang tak ada; bila berkas itu dijalankan kemudian, langkah 2 di bawah yang
-- mencegahnya lahir terbuka.
--
-- rls_auto_enable() SENGAJA tidak disentuh: itu fungsi bawaan Supabase untuk fitur RLS otomatis,
-- bukan milik aplikasi ini.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_order_with_items',
        'adjust_warehouse_stock_atomic',
        'adjust_product_stock_atomic'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

-- === 2. Jangan sampai terulang ===
--
-- Fungsi yang dibuat SESUDAH ini oleh role postgres (role yang menjalankan SQL Editor) tidak lagi
-- otomatis bisa dipanggil semua orang. Fungsi baru yang memang perlu dipanggil dari browser harus
-- diberi izin secara eksplisit — keputusan yang sadar, bukan kebocoran bawaan.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- === 3. Catat di ledger (SEC-036) ===
insert into public.schema_migrations (version, note)
values ('20260914130000_cabut_execute_fungsi_publik', 'dijalankan manual')
on conflict (version) do nothing;

-- === Verifikasi sesudah dijalankan ===
-- Jalankan ulang query izin fungsi yang sama:
--   select p.oid::regprocedure as fungsi,
--          has_function_privilege('anon', p.oid, 'execute') as anon_boleh_panggil,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_boleh_panggil,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role_boleh_panggil
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef order by 1;
-- create_order_with_items harus: anon=false, authenticated=false, service_role=true.
-- Lalu satu checkout sungguhan sampai halaman pembayaran harus tetap berhasil.
