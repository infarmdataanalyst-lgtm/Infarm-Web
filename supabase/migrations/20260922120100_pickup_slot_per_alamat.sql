-- supabase/migrations/20260922120100_pickup_slot_per_alamat.sql
-- Slot pickup harian menjadi satu baris per (TANGGAL x ALAMAT PENJEMPUTAN), bukan per tanggal.
--
-- Sebelum ini akun hanya punya SATU alamat pickup, jadi "satu time_id per tanggal" sudah cukup dan
-- `date` dibuat UNIQUE. Dengan dua gudang yang masing-masing punya alamat sendiri, satu slot per
-- tanggal berarti paket dari gudang kedua terdaftar pada slot penjemputan gudang pertama.
--
-- Mengantar TIDAK menolak kekeliruan itu: uji sandbox 22 Sep 2026 (Notion Testing Mengantar MGT-57)
-- mengirim address_id Cengkareng berpasangan dengan time_id milik alamat lain, dan booking DITERIMA
-- tanpa error. Jadi pasangan (alamat, slot) hanya bisa dijaga oleh kita — lewat kunci di tabel ini.
--
-- Uji sandbox yang sama (MGT-56) membuktikan satu akun BOLEH punya beberapa slot pada tanggal & jam
-- yang identik untuk alamat berbeda. Itulah prasyarat dicabutnya UNIQUE(date).
--
-- KENAPA address_id DISIMPAN, bukan ditanyakan balik ke Mengantar: kolom lebih murah daripada satu
-- panggilan API di jalur bayar, dan menjadi satu-satunya tempat yang mengikat slot ke alamatnya.
--
-- === DUA FASE, DISENGAJA ===
-- Fase A (file ini) dijalankan SEBELUM kode baru dideploy, dan HARUS tetap bisa dilayani kode LAMA
-- yang masih menulis insert({date, time_id}) tanpa address_id. Karena itu kolomnya nullable dan
-- diberi DEFAULT alamat lama: insert kode lama tetap sah dan tetap mendarat di alamat yang benar.
-- Fase B (20260922120200) mencabut default itu setelah kode baru live.
--
-- JENDELA BERBAHAYA antara file ini dan deploy kode baru: kode lama masih membaca slot dengan
-- getPickupByDate(date).maybeSingle() tanpa filter alamat. Aman selama tiap tanggal hanya punya
-- SATU baris. Jangan jalankan cron manual dan jangan sisipkan slot alamat kedua lewat SQL sampai
-- kode baru live — baris kedua bertanggal sama akan membuat maybeSingle() galat.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

-- ALAMAT LAMA = nilai env MENGANTAR_STORE_ADDRESS_ID yang berlaku per 22 Sep 2026, yaitu alamat
-- INFARM (Jl Melati no 9, Cengkareng Barat) di Mengantar SANDBOX. Lokal dan Vercel sama-sama memakai
-- nilai ini (sistem masih pra-rilis). Seluruh baris lama dibuat saat akun hanya punya alamat ini,
-- jadi pemiliknya pasti alamat ini — isian otomatis di bawah bukan tebakan.

alter table public.mengantar_daily_pickup
  add column if not exists address_id text;

update public.mengantar_daily_pickup
   set address_id = '6a83baf39124abb5652fa63a'
 where address_id is null;

-- Jembatan untuk kode LAMA yang masih berjalan sampai deploy selesai. Dicabut di fase B.
alter table public.mengantar_daily_pickup
  alter column address_id set default '6a83baf39124abb5652fa63a';

-- Kunci pengganti DIBUAT DULU, baru kunci lama dicabut. Urutan terbalik menyisakan jeda tanpa
-- penjaga keunikan sama sekali. Selama keduanya hidup berdampingan tak ada yang bentrok: tiap
-- tanggal masih punya tepat satu baris, jadi (date, address_id) pun otomatis unik.
--
-- Keunikan inilah yang dipakai savePickup untuk menyelesaikan balapan lewat 23505, bukan lewat
-- cek-lalu-tulis.
create unique index if not exists mengantar_daily_pickup_date_address_idx
  on public.mengantar_daily_pickup (date, address_id);

-- UNIQUE(date) dicabut: dengan dua alamat, dua baris bertanggal sama adalah kondisi NORMAL.
--
-- Constraint dicari lewat KOLOMNYA, bukan lewat nama. Namanya dibuat otomatis oleh Postgres dari
-- `date date not null unique` (migration 20260820120000) dan biasanya `mengantar_daily_pickup_date_key`
-- — tapi `drop constraint if exists <nama tebakan>` akan diam-diam tak melakukan apa pun bila tebakannya
-- meleset, UNIQUE(date) tetap hidup, dan slot alamat kedua gagal disimpan tanpa penjelasan.
do $$
declare
  v_conname text;
begin
  for v_conname in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.mengantar_daily_pickup'::regclass
      and c.contype = 'u'
      and c.conkey = array[(
        select a.attnum
        from pg_attribute a
        where a.attrelid = 'public.mengantar_daily_pickup'::regclass
          and a.attname = 'date'
      )]::smallint[]
  loop
    execute format('alter table public.mengantar_daily_pickup drop constraint %I', v_conname);
    raise notice 'UNIQUE(date) dicabut: %', v_conname;
  end loop;
end $$;

comment on column public.mengantar_daily_pickup.address_id is
  '_id alamat penjemputan Mengantar (warehouses.mengantar_address_id) yang memiliki slot ini. '
  'Mengantar menerima pasangan address_id/time_id yang tak cocok tanpa error (MGT-57), jadi kolom '
  'inilah yang menjaga slot tetap terikat ke alamatnya.';

-- =================================================================================================
-- VERIFIKASI SESUDAH MENJALANKAN (jalankan terpisah)
-- =================================================================================================
--
-- 1. Tidak boleh ada baris tanpa alamat:
--      select count(*) from public.mengantar_daily_pickup where address_id is null;   -- harus 0
--
-- 2. UNIQUE(date) sudah hilang, digantikan index (date, address_id):
--      select conname, contype from pg_constraint
--       where conrelid = 'public.mengantar_daily_pickup'::regclass;
--      -> TIDAK boleh ada baris contype 'u' (unique) untuk kolom date. Baris 'p' (primary key) wajar.
--
--      select indexname, indexdef from pg_indexes
--       where tablename = 'mengantar_daily_pickup';
--      -> harus ada mengantar_daily_pickup_date_address_idx ... (date, address_id)
