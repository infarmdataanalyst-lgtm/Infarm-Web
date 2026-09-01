-- supabase/scripts/backfill-email-dummy.sql
-- SEKALI PAKAI, BUKAN MIGRATION. Sengaja di supabase/scripts/, bukan supabase/migrations/:
-- ini menambal DATA untuk keperluan testing, bukan mengubah struktur. Menaruhnya di migrations
-- berarti ia ikut jalan di setiap environment baru, termasuk production yang datanya masih bersih.
--
-- Tujuan: mengisi orders.email yang masih NULL dengan satu email dummy, supaya alur Batalkan
-- Pesanan dan Review Produk (yang berpindah ke pencarian berbasis email) punya data untuk diuji.
-- Tanpa ini 46 dari 69 pesanan tak akan pernah muncul di pencarian mana pun.
--
-- ⚠️ BACA SEBELUM MENJALANKAN
-- Setelah ini SATU email memiliki 46 pesanan milik orang yang BERBEDA-BEDA. Siapa pun yang
-- mengetik email dummy itu akan melihat seluruh 46 pesanan tersebut beserta isi belanjaannya.
-- Untuk data dev/staging ini tidak apa-apa. JANGAN dijalankan di database yang memuat pesanan
-- pelanggan sungguhan.
--
-- Emailnya ditulis huruf kecil semua. Itu WAJIB: pencarian mencocokkan secara persis, dan sisi
-- aplikasi selalu menormalkan ke huruf kecil lewat normalizeEmail() (src/lib/email.ts). Email
-- dummy berhuruf besar tak akan pernah cocok dengan apa pun.

-- === 1. Lihat dulu yang akan terkena (jalankan sendiri, tanpa mengubah apa-apa) ===
select count(*) as akan_diisi
from public.orders
where email is null or btrim(email) = '';

-- === 2. Isi email yang kosong ===
-- NULL dan string kosong sama-sama ditangani: keduanya sama-sama tak bisa dicari.
update public.orders
set email = 'infarmdataanalyst@gmail.com'
where email is null or btrim(email) = '';

-- === 3. Verifikasi hasilnya ===
select
  count(*) filter (where email is null or btrim(email) = '') as masih_kosong,   -- harus 0
  count(*) filter (where email = 'infarmdataanalyst@gmail.com') as email_dummy,
  count(*) filter (where email is not null and btrim(email) <> ''
                     and email <> 'infarmdataanalyst@gmail.com') as email_asli,
  count(*) as total
from public.orders;

-- === 4. Cara membatalkan (bila perlu) ===
-- Mengembalikan ke NULL semua baris yang memakai email dummy:
--
--   update public.orders
--   set email = null
--   where email = 'infarmdataanalyst@gmail.com';
--
-- Catatan: perintah itu mengenali baris HANYA dari nilai emailnya. Bila nanti ada pesanan
-- SUNGGUHAN yang memakai alamat yang sama, ia akan ikut dikosongkan. Jalankan pengembalian ini
-- sebelum alamat tersebut dipakai checkout beneran.
