# PANDUAN IMPLEMENTASI — Dua Alamat Pickup Mengantar (satu per gudang)

Repo: `C:\Users\fiqih\OneDrive\Dokumen\Infarm Web\Infarm-Web`
Referensi rencana: `ROADMAP.md:86`, `docs/checkout-flow.md:366-402`
Nomor baris di bawah = kondisi repo saat panduan ini ditulis (2026-09-22).

---

## PRASYARAT (selesaikan SEBELUM menyentuh apa pun)

**Akses**
1. Dashboard Mengantar + **`MENGANTAR_API_KEY`** untuk **dua host**: `https://sandbox.mengantar.com` (uji) dan `https://app.mengantar.com` (produksi). Alamat yang didaftarkan di sandbox **TIDAK ada** di produksi — langkah 1 dijalankan **dua kali**, sekali per host, dengan key masing-masing.
2. Supabase SQL Editor (migration dijalankan manual) + hak `service_role`.
3. Vercel → Project → Settings → Environment Variables (untuk mencabut env di langkah 5).
4. `.env.local` lokal + Git Bash (contoh `curl` di bawah memakai sintaks POSIX; jalankan di Git Bash, bukan PowerShell — tanda kutip tunggal di PowerShell tidak melindungi `$`).

**Data yang harus sudah ada di tangan** (Mengantar mewajibkan, tak bisa dikarang belakangan)
| Field | Gudang Utama Infarm | Gudang Jakarta |
|---|---|---|
| `PICKUP_NAME` (nama gudang di Mengantar) | mis. `Infarm Gudang Utama` | mis. `Infarm Gudang Jakarta` |
| `PICKUP_ADDRESS` (detail jalan) | alamat Keputih/Sukolilo sebenarnya | `Jl Melati no 9` (sudah ada) |
| `PICKUP_PIC` + `PICKUP_PIC_PHONE` | nama & HP penjemputan Surabaya | nama & HP penjemputan Jakarta |
| `PICKUP_AUTOFILL` | `_id` kelurahan dari `GET /address/search` | `_id` kelurahan Cengkareng |

**Kondisi awal yang perlu dicatat** (jalankan dulu, simpan hasilnya):
```sql
select id, nama, mengantar_origin_id, is_default, is_active
from public.warehouses order by created_at;

select date, time_id, created_at from public.mengantar_daily_pickup
order by date desc limit 10;
```
Dan catat nilai env sekarang: `MENGANTAR_STORE_ADDRESS_ID`, `MENGANTAR_PICKUP_ORIGIN_ID` (= `5fc62f5ff8f44b34aa4c0dbc`), `MENGANTAR_PICKUP_TIME_ID`, `MENGANTAR_BASE_URL`.

**Backup**: Supabase → Database → Backups, pastikan ada snapshot hari ini. Tiga tabel yang disentuh: `warehouses` (tambah kolom), `mengantar_daily_pickup` (tambah kolom + ganti unique), `orders` (tidak disentuh sama sekali).

**Branch**: `git checkout -b feat/alamat-pickup-per-gudang`. Vercel men-deploy dari push ke branch utama, jadi **selama branch belum di-merge tak ada yang berubah di produksi** — itulah ruang aman untuk langkah 1–4.

**Catatan penjaga tulis**: `src/lib/mengantar-host.ts:106-119` (`mengantarWriteHost`) memblokir `POST /time` & `POST /order` ke host produksi dari luar deployment produksi. Penjaga itu **tidak berlaku untuk `curl` manual** — `POST /address` dari laptop ke host produksi diizinkan dan memang perlu (mendaftarkan alamat tidak memotong saldo, tidak menerbitkan resi). Yang tidak boleh: memicu `POST /time`/`POST /order` produksi dari lokal.

---

## LANGKAH 1 — Daftarkan alamat tiap gudang, simpan `_id` ke `warehouses.mengantar_address_id`

**Tujuan.** Memberi setiap gudang alamat penjemputannya sendiri di akun Mengantar dan menyimpan `_id`-nya di DB, supaya langkah-langkah berikutnya punya sesuatu untuk ditunjuk.

**Kenapa pertama.** Tiga langkah berikutnya semuanya membaca kolom ini. Tanpa `_id` di DB, langkah 3 tak punya daftar alamat untuk dibuatkan slot, langkah 4 tak punya alamat untuk dipakai booking, dan langkah 5 akan mencabut penyelarasan tanpa ada penggantinya.

**Besarnya perubahan.** 1 migration + 3 file kode (semuanya jalur BACA saja) + 2 panggilan API manual per host.

### 1a. Migration

File baru: `supabase/migrations/20260922120000_warehouses_mengantar_address_id.sql`
(konvensi nyata di folder itu: `YYYYMMDDHHMMSS_snake_case.sql`, header baris pertama = path file sendiri, lalu alasan — lihat `20260909120000_orders_mengantar_ids.sql`)

```sql
-- supabase/migrations/20260922120000_warehouses_mengantar_address_id.sql
-- Alamat PENJEMPUTAN Mengantar per gudang.
--
-- KENAPA kolom BARU dan bukan memakai mengantar_origin_id: keduanya ObjectId 24 hex dari Mengantar,
-- tapi menunjuk BENDA yang berbeda dan dipakai endpoint yang berbeda.
--   mengantar_origin_id  = _id KELURAHAN asal kirim   -> cek ongkir (GET allEstimatePublic)
--   mengantar_address_id = _id ALAMAT milik akun kita -> POST /time (address_id) & POST /order
--                                                        (pickup.address_id)
-- `POST /order` TIDAK punya field origin sama sekali: Mengantar menagih berdasarkan alamat
-- penjemputan. Itulah akar masalah "dikutip Surabaya, ditagih Cengkareng" yang sementara ini
-- ditambal env MENGANTAR_PICKUP_ORIGIN_ID.
--
-- NULL = gudang ini belum punya alamat sendiri dan tetap dijemput di alamat env
-- MENGANTAR_STORE_ADDRESS_ID. Karena itu migration ini AMAN dijalankan sebelum kodenya dideploy:
-- tak ada satu pun jalur yang berubah perilakunya hanya karena kolom ini muncul.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

alter table public.warehouses
  add column if not exists mengantar_address_id varchar;

comment on column public.warehouses.mengantar_address_id is
  '_id alamat penjemputan gudang ini di akun Mengantar (ObjectId 24 hex), hasil POST '
  '/api/public/{KEY}/address. Dipakai sebagai address_id pada POST /time dan pickup.address_id '
  'pada POST /order. BEDA dari mengantar_origin_id (itu _id kelurahan untuk cek ongkir). '
  'NULL = gudang ini masih menumpang alamat env MENGANTAR_STORE_ADDRESS_ID.';
```

### 1b. Panggilan API Mengantar

Siapkan variabel (Git Bash):
```bash
KEY='API-XXXXXXXXXXXXXXXX'          # <-- ganti; JANGAN commit, JANGAN tulis ke log
BASE='https://sandbox.mengantar.com' # uji dulu; produksi: https://app.mengantar.com
```

**(i) Lihat dulu alamat yang SUDAH terdaftar** — jangan langsung membuat, akun ini sudah punya satu (`MENGANTAR_STORE_ADDRESS_ID`):
```bash
curl -s "$BASE/api/public/$KEY/address" | python -m json.tool
```
Catat `_id`, `PICKUP_NAME`, `PICKUP_ADDRESS`, `PICKUP_AUTOFILL`, `PICKUP_ORIGIN_CODE` tiap entri.

**(ii) Cari `_id` kelurahan untuk `PICKUP_AUTOFILL`** (endpoint search, tanpa host khusus — master wilayah identik di kedua host, lihat `mengantar-host.ts:127-138`):
```bash
curl -s "$BASE/api/public/$KEY/address/search?keyword=Keputih"   | python -m json.tool
curl -s "$BASE/api/public/$KEY/address/search?keyword=Cengkareng" | python -m json.tool
```
Ambil `_id` kelurahan yang benar. **Untuk Gudang Utama, `_id` yang dipilih HARUS sama dengan `warehouses.mengantar_origin_id` gudang itu** — itu inti langkah 2, jadi lebih murah menyamakannya sejak sekarang daripada memperbaikinya nanti.

**(iii) Daftarkan alamat Gudang Utama (Surabaya):**
```bash
curl -s -X POST "$BASE/api/public/$KEY/address" \
  -H 'Content-Type: application/json' \
  -d '{
    "PICKUP_AUTOFILL": "<_id kelurahan Keputih/Sukolilo>",
    "PICKUP_ADDRESS": "<detail jalan gudang Surabaya>",
    "PICKUP_NAME": "Infarm Gudang Utama",
    "PICKUP_PIC": "<nama PIC>",
    "PICKUP_PIC_PHONE": "<08xxxxxxxxxx>"
  }' | python -m json.tool
```
Respons membawa `_id` alamat baru + `PICKUP_ORIGIN_CODE`, `PICKUP_DESTINATION_CODE`, `PICKUP_SAP_CODE`. **Catat `_id` dan `PICKUP_ORIGIN_CODE`.**

**(iv) Gudang Jakarta**: alamat Cengkareng **sudah ada** (itulah `MENGANTAR_STORE_ADDRESS_ID`). Jangan buat duplikat — pakai `_id` yang sudah ada. Kalau `PICKUP_NAME`-nya masih generik, rapikan lewat update parsial:
```bash
curl -s -X PUT "$BASE/api/public/$KEY/address/<_id alamat cengkareng>" \
  -H 'Content-Type: application/json' \
  -d '{ "PICKUP_NAME": "Infarm Gudang Jakarta" }' | python -m json.tool
```

**(v) Simpan `_id` ke DB** (SQL Editor; pakai `id` gudang, bukan `nama` — nama bisa diubah dari OMS):
```sql
-- lihat dulu id-nya
select id, nama from public.warehouses order by created_at;

update public.warehouses
   set mengantar_address_id = '<_id alamat Surabaya>'
 where id = '<uuid Gudang Utama Infarm>';

update public.warehouses
   set mengantar_address_id = '<_id alamat Cengkareng>'
 where id = '<uuid Gudang Jakarta>';
```

### 1c. Kode — jalur BACA saja

**`src/types/warehouse.ts:12-25`**
```diff
 // Satu gudang. `mengantarOriginId` dipakai sebagai origin_id saat cek ongkir / booking kurir.
+// `mengantarAddressId` BERBEDA: itu _id ALAMAT PENJEMPUTAN milik akun Mengantar kita, yang
+// menentukan dari mana kurir mengambil paket DAN dari mana Mengantar menagih ongkirnya.
+// Dua nilai ini sama-sama ObjectId 24 hex, jadi tertukar tidak akan ketahuan sampai booking gagal.
 // latitude/longitude opsional dan TIDAK dipakai logika pemilihan gudang (pemilihan memakai
 // perbandingan ongkir riil). Disimpan untuk keperluan tampilan/peta di masa depan.
 export type Warehouse = {
   id: string
   nama: string
   alamat?: string
   mengantarOriginId?: string
+  mengantarAddressId?: string
   latitude?: number
```

**`src/lib/mock-db/warehouses.ts:34-44`**
```diff
 type WarehouseRow = {
   id: string
   nama: string
   alamat: string | null
   mengantar_origin_id: string | null
+  mengantar_address_id: string | null
   latitude: number | string | null
```
**`src/lib/mock-db/warehouses.ts:61-73`**
```diff
     mengantarOriginId: row.mengantar_origin_id ?? undefined,
+    mengantarAddressId: row.mengantar_address_id ?? undefined,
     latitude: toNumber(row.latitude),
```

> **JANGAN** menambahkan `mengantarAddressId` ke `WarehouseInput` (`warehouses.ts:140-148`) dan `inputToRow` (`160-169`) pada langkah ini. `inputToRow` dipakai `updateWarehouse`, dan form OMS (`src/app/oms/dashboard/gudang/page.tsx`) tidak mengirim field itu — begitu ia masuk `inputToRow`, **setiap kali admin menyimpan gudang dari OMS, `mengantar_address_id` akan ditimpa `null`** dan booking diam-diam kembali ke alamat env. Kalau memang ingin field-nya bisa diisi dari OMS, itu paket tersendiri: tambah ke `WarehouseFieldKey`/`WAREHOUSE_FIELD_ORDER`/`WarehouseFormValues`/`toWarehouseFormValues`/`validateWarehouseForm` di `src/lib/warehouse-validation.ts` (regex `MENGANTAR_ORIGIN_ID_REGEX` di baris 11 bisa dipakai ulang — formatnya sama 24 hex), input di `page.tsx:390`, dan payload di `src/app/api/warehouses/{create,update}/route.ts:36`. Sampai itu dikerjakan, kolom ini **hanya diisi lewat SQL**.

**`src/lib/warehouse.ts:113-121`** — tambahkan akses baru tepat di bawah `getOriginIdForWarehouse` (aturan repo: origin/alamat hanya dibaca lewat file ini — `docs/warehouse.md:45-46`):
```diff
   return (
     warehouse?.mengantarOriginId?.trim() ||
     process.env.MENGANTAR_ORIGIN_ID?.trim() ||
     process.env.NEXT_PUBLIC_MENGANTAR_ORIGIN_ID?.trim() ||
     ''
   )
 }
+
+// Mengambil _id ALAMAT PENJEMPUTAN Mengantar milik satu gudang — dipakai sebagai `address_id`
+// pada POST /time dan `pickup.address_id` pada POST /order.
+//
+// Kenapa terpisah dari getOriginIdForWarehouse: origin adalah KELURAHAN (dipakai cek ongkir),
+// alamat adalah BARIS ALAMAT milik akun kita (dipakai penjemputan & penagihan). Keduanya ObjectId
+// 24 hex, jadi kalau dilayani satu fungsi yang sama, tertukarnya tak akan tertangkap tipe mana pun
+// dan baru ketahuan saat kurir datang ke gudang yang salah.
+//
+// Fallback ke MENGANTAR_STORE_ADDRESS_ID DISENGAJA dan TIDAK BOLEH DIHAPUS: pesanan lama
+// (orders.warehouse_id NULL) dan gudang yang belum didaftarkan alamatnya tetap harus bisa dibooking.
+// String kosong hanya bila env itu pun kosong — pemanggil memperlakukannya sebagai 'not-configured'.
+export async function getPickupAddressIdForWarehouse(warehouseId?: string): Promise<string> {
+  const warehouse = warehouseId ? await getWarehouseById(warehouseId) : await getDefaultWarehouse()
+  return (
+    warehouse?.mengantarAddressId?.trim() || process.env.MENGANTAR_STORE_ADDRESS_ID?.trim() || ''
+  )
+}
```

### Verifikasi sebelum lanjut
```sql
select nama, mengantar_origin_id, mengantar_address_id, is_active
from public.warehouses order by created_at;
```
Harus: **dua baris, `mengantar_address_id` terisi 24 hex, dan kedua nilainya BERBEDA.** Lalu:
```bash
npm run lint && npm run typecheck
```
Kedua perintah ini persis yang dijalankan CI (`.github/workflows/ci.yml`) pada tiap pull request, jadi jalankan lokal sebelum push.

Terakhir, buktikan alamat benar-benar terdaftar di sisi Mengantar: `GET /address` mengembalikan **dua** entri dengan `_id` yang sama dengan isi kolom.

### Kalau langkah ini dilewati
Tak ada yang rusak — tapi langkah 3, 4, dan 5 semuanya kehilangan pijakan. Langkah 3 akan membuat slot untuk daftar alamat kosong (jatuh ke env, kembali ke satu alamat), langkah 4 akan selalu memakai fallback env, dan langkah 5 akan mengembalikan bug kutipan-vs-tagihan.

### Rollback
```sql
alter table public.warehouses drop column if exists mengantar_address_id;
```
Plus `git revert` commit kode. Alamat di sisi Mengantar boleh dibiarkan (tak memotong saldo); kalau mau bersih: `curl -X DELETE "$BASE/api/public/$KEY/address" -H 'Content-Type: application/json' -d '{"id":"<_id>"}'`.

---

## LANGKAH 2 — Selaraskan `PICKUP_AUTOFILL` alamat = `mengantar_origin_id` gudangnya

**Tujuan.** Memastikan kelurahan yang dipakai MENGUTIP ongkir sama dengan kelurahan alamat yang dipakai MENAGIH, per gudang.

**Kenapa di sini.** Ini prasyarat kebenaran langkah 5. Langkah 5 mengembalikan kutipan ke origin per gudang; kalau alamat gudang itu berada di zona tarif lain, selisih kutipan-vs-tagihan yang hari ini ditambal `MENGANTAR_PICKUP_ORIGIN_ID` akan kembali persis seperti semula — hanya dengan dua alamat, bukan satu.

**Besarnya perubahan.** 0 file kode, 0 migration. Murni data + verifikasi. (Opsional: 1 query pemantau.)

### 2a. Bandingkan pasangan nilainya
```sql
select nama, mengantar_origin_id, mengantar_address_id from public.warehouses order by created_at;
```
```bash
curl -s "$BASE/api/public/$KEY/address" | python -m json.tool | grep -E '"_id"|PICKUP_AUTOFILL|PICKUP_ORIGIN_CODE|PICKUP_NAME'
```
Untuk tiap gudang: `mengantar_origin_id` (DB) **harus** sama dengan `PICKUP_AUTOFILL` alamat yang `_id`-nya tersimpan di `mengantar_address_id`.

### 2b. Kalau belum sama — perbaiki dari sisi Mengantar
```bash
curl -s -X PUT "$BASE/api/public/$KEY/address/<_id alamat>" \
  -H 'Content-Type: application/json' \
  -d '{ "PICKUP_AUTOFILL": "<mengantar_origin_id gudang yang sama>" }' | python -m json.tool
```
Alternatif yang sah: ubah `mengantar_origin_id` di DB agar mengikuti `PICKUP_AUTOFILL` alamat. Keduanya benar; pilih arah yang **tidak memindahkan lokasi fisik gudang**. Untuk Gudang Jakarta, `PICKUP_AUTOFILL`-nya CENGKARENG BARAT sementara `mengantar_origin_id`-nya Kedaung Kali Angke — keduanya berbagi `ORIGIN_CODE CGK10000` / `JT_Code JKT001`, jadi **tarifnya sudah identik** dan ini murni kerapian. Yang tidak boleh dibiarkan adalah pasangan lintas-kota seperti Gudang Utama (Surabaya vs Cengkareng).

### Verifikasi sebelum lanjut
Bandingkan `PICKUP_ORIGIN_CODE` tiap alamat (dari respons `GET /address`) dan buktikan tarifnya sama lewat endpoint publik (tanpa API key, diskon flat 20%):
```bash
DEST='<_id kelurahan tujuan uji, mis. Kemayoran>'
# Tarif dari origin gudang (yang akan dipakai MENGUTIP setelah langkah 5)
curl -s "$BASE/api/order/allEstimatePublic?origin_id=<mengantar_origin_id gudang>&destination_id=$DEST&weight=1" | python -m json.tool
# Tarif dari kelurahan ALAMAT PICKUP gudang itu (yang akan ditagih)
curl -s "$BASE/api/order/allEstimatePublic?origin_id=<PICKUP_AUTOFILL alamat>&destination_id=$DEST&weight=1" | python -m json.tool
```
**Lulus bila angka `JT` pada kedua panggilan identik, untuk KEDUA gudang.** Ulangi dengan minimal 2 tujuan berbeda (satu Jakarta, satu luar Jawa) sebelum menyatakan selaras.

⚠️ Selama `MENGANTAR_BASE_URL` masih sandbox, angka yang keluar adalah angka dummy (lihat `docs/checkout-flow.md:342-353`) — **uji kesamaannya boleh di sandbox, tapi kesimpulan "tarifnya wajar" hanya sah di host produksi.**

### Kalau langkah ini dilewati (atau dikerjakan setelah langkah 5)
Langkah 5 akan mencabut penyelarasan dan mengembalikan tepat bug yang dicatat di `src/lib/warehouse.ts:131-132`: `INV-20260820-4876` dikutip Rp18.000 (Surabaya→Kemayoran) tapi ditagih Rp25.000 (Cengkareng→Kemayoran). Selisihnya keluar dari saldo Mengantar dan tak muncul di kolom mana pun pada tabel `orders` (`ROADMAP.md:87` — kolom ongkir aktual memang belum ada), jadi kebocorannya hanya ketahuan dengan membandingkan dashboard Mengantar secara manual.

### Rollback
`PUT /address/{id}` dengan nilai `PICKUP_AUTOFILL` yang lama (catat nilai sebelumnya sebelum mengubah), atau `update public.warehouses set mengantar_origin_id = '<nilai lama>' where id = '<uuid>';`.

---

## LANGKAH 3 — Satu `time_id` per (tanggal × alamat)

**Tujuan.** Membuat slot penjemputan terpisah untuk tiap alamat, supaya kurir dijadwalkan datang ke dua gudang, bukan ke satu.

**Kenapa setelah 1–2, sebelum 4.** Langkah 4 mengirim `pickup.address_id` **dan** `pickup.time_id` dalam satu payload. Kalau langkah 4 lebih dulu, booking gudang Surabaya akan membawa alamat Surabaya tapi `time_id` milik slot Cengkareng — pasangan yang tidak konsisten. Catatan dokumentasi resmi: contoh respons `GET /time` **tidak menyertakan `address_id`**, jadi kita tidak bisa menanyakan balik "slot ini milik alamat mana" — **pemetaan slot→alamat wajib kita simpan sendiri**, dan itulah isi migration di bawah. *(Perlu dikonfirmasi: apakah `POST /order` menolak pasangan `address_id`/`time_id` yang tidak cocok, atau menerimanya diam-diam. Sampai terbukti menolak, asumsikan ia menerima — artinya kesalahan pasangan tidak akan memberi error, hanya kurir yang datang ke tempat yang salah.)*

**Besarnya perubahan.** 2 migration (satu sekarang, satu setelah kode live) + 4 file kode. Ini langkah terbesar.

### 3a. Migration — fase A (dijalankan SEBELUM kode dideploy)

File baru: `supabase/migrations/20260922120100_pickup_slot_per_alamat.sql`

```sql
-- supabase/migrations/20260922120100_pickup_slot_per_alamat.sql
-- Slot pickup harian menjadi satu baris per (TANGGAL x ALAMAT PENJEMPUTAN), bukan per tanggal.
--
-- Sebelum ini akun hanya punya SATU alamat pickup, jadi "satu time_id per tanggal" sudah cukup dan
-- `date` dibuat UNIQUE. Dengan dua gudang yang masing-masing punya alamat sendiri, satu slot per
-- tanggal berarti paket dari gudang kedua terdaftar pada slot penjemputan gudang pertama — kurir
-- datang ke alamat yang salah, dan tak ada error apa pun yang menandainya.
--
-- KENAPA address_id harus DISIMPAN, bukan ditanyakan balik ke Mengantar: contoh respons GET /time
-- pada dokumentasi publik tidak memuat address_id. Jadi sekali slot dibuat, satu-satunya tempat
-- yang tahu slot itu milik alamat mana adalah baris ini.
--
-- === DUA FASE, DISENGAJA ===
-- Fase A (file ini) dijalankan SEBELUM kode baru dideploy, dan HARUS tetap bisa dilayani kode LAMA
-- yang masih menulis insert({date, time_id}) tanpa address_id. Karena itu kolomnya nullable dan
-- diberi DEFAULT alamat lama: insert kode lama tetap sah dan tetap mendarat di alamat yang benar.
-- Fase B (20260922120200) mencabut default itu setelah kode baru live.
--
-- Dijalankan MANUAL lewat Dashboard -> SQL Editor. Aman dijalankan ulang (idempotent).

-- GANTI <ALAMAT_LAMA> dengan nilai env MENGANTAR_STORE_ADDRESS_ID yang sedang berlaku.
alter table public.mengantar_daily_pickup
  add column if not exists address_id text;

-- Seluruh baris lama dibuat saat akun hanya punya satu alamat, jadi pemiliknya pasti alamat itu.
update public.mengantar_daily_pickup
   set address_id = '<ALAMAT_LAMA>'
 where address_id is null;

-- Jembatan untuk kode LAMA yang masih berjalan sampai deploy selesai. Dicabut di fase B.
alter table public.mengantar_daily_pickup
  alter column address_id set default '<ALAMAT_LAMA>';

-- UNIQUE(date) WAJIB dicabut: dengan dua alamat, dua baris bertanggal sama adalah kondisi NORMAL.
-- Nama constraint di bawah = nama otomatis Postgres untuk `date date not null unique` pada
-- migration 20260820120000_init_mengantar_daily_pickup.sql.
alter table public.mengantar_daily_pickup
  drop constraint if exists mengantar_daily_pickup_date_key;

-- Penggantinya. Keunikan tetap ada, hanya pindah ke pasangan (tanggal, alamat) — dan keunikan
-- inilah yang dipakai savePickup untuk menyelesaikan balapan lewat 23505, bukan lewat cek-lalu-tulis.
create unique index if not exists mengantar_daily_pickup_date_address_idx
  on public.mengantar_daily_pickup (date, address_id);

comment on column public.mengantar_daily_pickup.address_id is
  '_id alamat penjemputan Mengantar (warehouses.mengantar_address_id) yang memiliki slot ini. '
  'Disimpan karena respons GET /time tidak membawanya — tanpa kolom ini, slot tak bisa lagi '
  'dihubungkan ke gudangnya setelah dibuat.';
```

### 3b. Kode

**`src/lib/mock-db/pickup.ts:9-23`**
```diff
 // Satu baris jadwal pickup harian.
 export type DailyPickup = {
   date: string // YYYY-MM-DD (WIB), tanggal PICKUP
+  addressId: string // alamat penjemputan pemilik slot ini (warehouses.mengantar_address_id)
   timeId: string // time_id dari Mengantar
   createdAt: string
 }

 type PickupRow = {
   date: string
+  address_id: string
   time_id: string
   created_at: string
 }

 function rowToPickup(row: PickupRow): DailyPickup {
-  return { date: row.date, timeId: row.time_id, createdAt: row.created_at }
+  return {
+    date: row.date,
+    addressId: row.address_id,
+    timeId: row.time_id,
+    createdAt: row.created_at,
+  }
 }
```

**`src/lib/mock-db/pickup.ts:25-41`**
```diff
-// Membaca jadwal pickup untuk satu tanggal. null bila belum ada, tabel belum di-migrate, atau
-// koneksi bermasalah — pemanggil WAJIB punya jalur cadangan sendiri. Jangan biarkan gangguan
-// tabel ini menggagalkan pembuatan order.
-export async function getPickupByDate(date: string): Promise<DailyPickup | null> {
+// Membaca jadwal pickup untuk satu tanggal DI SATU ALAMAT. null bila belum ada, tabel belum
+// di-migrate, atau koneksi bermasalah — pemanggil WAJIB punya jalur cadangan sendiri. Jangan
+// biarkan gangguan tabel ini menggagalkan pembuatan order.
+//
+// `addressId` WAJIB, bukan opsional: tanpa filter alamat, maybeSingle() akan GALAT begitu ada
+// gudang kedua (dua baris untuk tanggal yang sama), dan galat itu muncul sebagai "tak ada slot"
+// yang menjatuhkan seluruh booking ke jalur fallback.
+export async function getPickupByDate(
+  date: string,
+  addressId: string,
+): Promise<DailyPickup | null> {
   const supabase = createAdminClient()
   const { data, error } = await supabase
     .from('mengantar_daily_pickup')
-    .select('date, time_id, created_at')
+    .select('date, address_id, time_id, created_at')
     .eq('date', date)
+    .eq('address_id', addressId)
     .maybeSingle()

   if (error) {
-    console.error(`Gagal membaca jadwal pickup ${date}:`, error.message)
+    console.error(`Gagal membaca jadwal pickup ${date} alamat ${addressId}:`, error.message)
     return null
   }
   return data ? rowToPickup(data as PickupRow) : null
 }
```

**`src/lib/mock-db/pickup.ts:50-77`**
```diff
-export async function savePickup(date: string, timeId: string): Promise<SavePickupResult | null> {
+export async function savePickup(
+  date: string,
+  addressId: string,
+  timeId: string,
+): Promise<SavePickupResult | null> {
   const supabase = createAdminClient()
   const { data, error } = await supabase
     .from('mengantar_daily_pickup')
-    .insert({ date, time_id: timeId })
-    .select('date, time_id, created_at')
+    .insert({ date, address_id: addressId, time_id: timeId })
+    .select('date, address_id, time_id, created_at')
     .single()

   if (!error && data) return { pickup: rowToPickup(data as PickupRow), inserted: true }

-  // 23505 = unique_violation → pemanggil lain menang. Ambil punya dia.
+  // 23505 = unique_violation pada (date, address_id) → pemanggil lain menang. Ambil punya dia.
   if (error?.code === '23505') {
-    const existing = await getPickupByDate(date)
+    const existing = await getPickupByDate(date, addressId)
     if (existing) return { pickup: existing, inserted: false }
   }

-  console.error(`Gagal menyimpan jadwal pickup ${date}:`, error?.message ?? 'tidak diketahui')
+  console.error(
+    `Gagal menyimpan jadwal pickup ${date} alamat ${addressId}:`,
+    error?.message ?? 'tidak diketahui',
+  )
   return null
 }
```

**`src/lib/mengantar-pickup.ts:99-124`** — alamat jadi parameter, bukan env:
```diff
-// Meminta slot pickup baru ke Mengantar untuk satu tanggal. TIDAK menyentuh DB — pemisahan ini
-// membuat pemanggil yang menyimpan hasilnya bisa memutuskan sendiri apa yang dilakukan saat gagal.
-export async function createPickupTime(date: string): Promise<CreateTimeResult> {
+// Meminta slot pickup baru ke Mengantar untuk satu tanggal DI SATU ALAMAT. TIDAK menyentuh DB —
+// pemisahan ini membuat pemanggil yang menyimpan hasilnya bisa memutuskan sendiri apa yang
+// dilakukan saat gagal.
+//
+// `addressId` datang dari pemanggil (warehouses.mengantar_address_id lewat lib/warehouse.ts),
+// BUKAN dari env: sejak tiap gudang punya alamat sendiri, membaca env di sini berarti seluruh
+// gudang kembali berbagi satu slot — persis keadaan yang hendak ditinggalkan.
+export async function createPickupTime(
+  date: string,
+  addressId: string,
+): Promise<CreateTimeResult> {
   const key = process.env.MENGANTAR_API_KEY
-  const addressId = process.env.MENGANTAR_STORE_ADDRESS_ID
```
dan di blok setelahnya (baris 108-111 & 114-117), log serta penjagaannya ikut menyebut alamat:
```diff
   const writeHost = mengantarWriteHost()
   if (!writeHost.allowed) {
-    console.warn(`${LOG} slot pickup ${date} DIBATALKAN — ${writeHost.reason}`)
+    console.warn(`${LOG} slot pickup ${date} alamat ${addressId} DIBATALKAN — ${writeHost.reason}`)
     return { ok: false, reason: 'blocked-environment', detail: writeHost.reason }
   }
```

**`src/lib/mengantar-pickup.ts:180-219`** (`ensurePickupForDate`):
```diff
-export async function ensurePickupForDate(date: string): Promise<EnsurePickupOutcome> {
+export async function ensurePickupForDate(
+  date: string,
+  addressId: string,
+): Promise<EnsurePickupOutcome> {
   if (parsePickupDate(date) === null) {
     return { status: 'failed', reason: `format tanggal tidak valid: ${date}` }
   }
+  if (!addressId.trim()) {
+    // Alamat kosong berarti konfigurasi gudang belum lengkap, bukan gangguan Mengantar —
+    // dibedakan supaya log cron tidak menuding pihak ketiga untuk kesalahan kita sendiri.
+    return { status: 'failed', reason: 'alamat-pickup-kosong' }
+  }
   if (!isPickupDay(date)) {
     // Minggu: tak ada penjemputan, jadi tak ada slot yang perlu dibuat.
     return { status: 'skipped-non-pickup-day' }
   }

-  const existing = await getPickupByDate(date)
+  const existing = await getPickupByDate(date, addressId)
   if (existing) {
-    console.log(`${LOG} ${date} sudah ada time_id — dilewati (idempoten)`)
+    console.log(`${LOG} ${date} alamat ${addressId} sudah ada time_id — dilewati (idempoten)`)
     return { status: 'existing', pickup: existing }
   }

-  const created = await createPickupTime(date)
+  const created = await createPickupTime(date, addressId)
   ...
-  const saved = await savePickup(date, created.timeId)
+  const saved = await savePickup(date, addressId, created.timeId)
```

**`src/lib/mengantar-pickup.ts:221-276`** (`getTodayPickupTimeId`):
```diff
 export type PickupTimeId = {
   timeId: string
+  addressId: string // alamat yang slot ini miliki — dicatat agar log booking bisa dicocokkan
   date: string // tanggal pickup yang berlaku
   reason: PickupDateReason
   source: PickupTimeIdSource
 }
```
```diff
-export async function getTodayPickupTimeId(
-  nowMs: number = Date.now(),
-): Promise<PickupTimeId | null> {
+// `addressId` = alamat penjemputan gudang PEMENUH pesanan ini. Parameter pertama, bukan opsional:
+// slot penjemputan hanya sah untuk alamatnya sendiri, jadi tak ada nilai bawaan yang masuk akal.
+export async function getTodayPickupTimeId(
+  addressId: string,
+  nowMs: number = Date.now(),
+): Promise<PickupTimeId | null> {
   const { date, reason, today, hour } = resolvePickupDate(nowMs)

-  const existing = await getPickupByDate(date)
-  if (existing) return { timeId: existing.timeId, date, reason, source: 'tabel' }
+  const existing = await getPickupByDate(date, addressId)
+  if (existing) return { timeId: existing.timeId, addressId, date, reason, source: 'tabel' }

   console.warn(
-    `${LOG} tabel kosong untuk ${date} (sekarang ${today} jam ${hour} WIB, alasan ${reason}) — fallback panggil Mengantar`,
+    `${LOG} tabel kosong untuk ${date} alamat ${addressId} (sekarang ${today} jam ${hour} WIB, alasan ${reason}) — fallback panggil Mengantar`,
   )
-  const outcome = await ensurePickupForDate(date)
+  const outcome = await ensurePickupForDate(date, addressId)
   if (outcome.status === 'created' || outcome.status === 'raced' || outcome.status === 'existing') {
-    return { timeId: outcome.pickup.timeId, date, reason, source: 'fallback-api' }
+    return { timeId: outcome.pickup.timeId, addressId, date, reason, source: 'fallback-api' }
   }

-  const staticId = process.env.MENGANTAR_PICKUP_TIME_ID
-  if (staticId) {
+  // Slot statis MENGANTAR_PICKUP_TIME_ID dibuat untuk SATU alamat: alamat env lama. Memakainya
+  // untuk alamat gudang lain berarti mendaftarkan paket ke slot penjemputan yang bukan miliknya.
+  // Belum dipastikan apakah Mengantar menolak pasangan address_id/time_id yang tak cocok atau
+  // menerimanya diam-diam — dan justru yang kedua yang berbahaya (kurir datang ke gudang salah
+  // tanpa satu pun error). Jadi lapis terakhir ini dibatasi ke alamat pemiliknya saja.
+  const staticId = process.env.MENGANTAR_PICKUP_TIME_ID
+  const legacyAddressId = process.env.MENGANTAR_STORE_ADDRESS_ID?.trim()
+  if (staticId && legacyAddressId && addressId === legacyAddressId) {
     console.error(
       `${LOG} fallback API gagal untuk ${date} — memakai MENGANTAR_PICKUP_TIME_ID statis. Periksa cron & konfigurasi Mengantar.`,
     )
-    return { timeId: staticId, date, reason, source: 'env-statis' }
+    return { timeId: staticId, addressId, date, reason, source: 'env-statis' }
   }

-  console.error(`${LOG} TIDAK ADA time_id untuk ${date} dan MENGANTAR_PICKUP_TIME_ID belum di-set`)
+  console.error(
+    `${LOG} TIDAK ADA time_id untuk ${date} alamat ${addressId} (slot statis tak berlaku untuk alamat ini)`,
+  )
   return null
 }
```
Perbarui juga komentar header file (`mengantar-pickup.ts:3` menyebut `MENGANTAR_STORE_ADDRESS_ID` sebagai env yang dipegang modul ini — sekarang tidak lagi) dan blok penjelasan baris 6-10 (“Satu slot dipakai untuk SEMUA paket hari itu” → “semua paket hari itu **dari alamat yang sama**”).

**`src/lib/warehouse.ts`** — daftar alamat untuk cron (satu pintu, sesuai `docs/warehouse.md:45-46`). Tempatkan di bawah `getPickupAddressIdForWarehouse`:
```ts
// Seluruh alamat penjemputan yang perlu punya slot pickup harian — dipakai cron.
//
// De-duplikasi DISENGAJA: dua gudang boleh berbagi satu alamat Mengantar (mis. saat gudang baru
// belum didaftarkan alamatnya sendiri). Slot dibuat per ALAMAT, bukan per gudang, karena itulah
// satuan yang dikenal Mengantar — membuat dua slot untuk alamat yang sama hanya menumpuk sampah
// di sistem kurir.
//
// Hanya gudang AKTIF: gudang nonaktif tak memenuhi pesanan, jadi tak ada paket yang perlu dijemput.
// Daftar kosong → jatuh ke MENGANTAR_STORE_ADDRESS_ID, sehingga cron tetap berjalan seperti
// sebelum kolom mengantar_address_id ada.
export async function listPickupAddressIds(): Promise<string[]> {
  const warehouses = await readWarehouses(true)
  const ids = new Set<string>()
  for (const w of warehouses) {
    const id = w.mengantarAddressId?.trim()
    if (id) ids.add(id)
  }
  if (ids.size === 0) {
    const fallback = process.env.MENGANTAR_STORE_ADDRESS_ID?.trim()
    if (fallback) ids.add(fallback)
  }
  return [...ids]
}
```

**`src/app/api/cron/mengantar-pickup/route.ts:18-20` & `60-93`**
```diff
 import { NextResponse } from 'next/server'
 import { ensurePickupForDate } from '@/lib/mengantar-pickup'
 import { resolvePickupDate, wibDateString, wibHour } from '@/lib/pickup-schedule'
+import { listPickupAddressIds } from '@/lib/warehouse'
 import { timingSafeEqual } from 'node:crypto'
```
```diff
   const today = wibDateString(nowMs)
   const resolved = resolvePickupDate(nowMs)

+  // Satu slot per ALAMAT penjemputan. Sebelum tiap gudang punya alamat sendiri, satu panggilan
+  // sudah cukup; sekarang gudang yang tak kebagian slot akan menjatuhkan booking-nya ke jalur
+  // fallback saat checkout — mahal, dan tepat di jalur bayar.
+  const addressIds = await listPickupAddressIds()
+  if (addressIds.length === 0) {
+    console.error(`${LOG} tak ada alamat penjemputan — isi warehouses.mengantar_address_id`)
+    return NextResponse.json({ error: 'Alamat penjemputan belum dikonfigurasi.' }, { status: 500 })
+  }
+
   console.log(
-    `${LOG} mulai — hari ini ${today} jam ${wibHour(nowMs)} WIB (target checkout saat ini: ${resolved.date}/${resolved.reason})`,
+    `${LOG} mulai — hari ini ${today} jam ${wibHour(nowMs)} WIB, ${addressIds.length} alamat (target checkout saat ini: ${resolved.date}/${resolved.reason})`,
   )

-  const outcome = await ensurePickupForDate(today)
-
-  switch (outcome.status) {
-    case 'skipped-non-pickup-day':
-      console.log(`${LOG} ${today} bukan hari pickup — dilewati`)
-      return NextResponse.json({ date: today, status: 'skipped', reason: 'BUKAN_HARI_PICKUP' })
-
-    case 'existing':
-      return NextResponse.json({ date: today, status: 'existing', timeId: outcome.pickup.timeId })
-
-    case 'created':
-    case 'raced':
-      return NextResponse.json({ date: today, status: outcome.status, timeId: outcome.pickup.timeId })
-
-    case 'failed':
-      // 500 supaya kegagalan terlihat di log & dasbor cron Vercel, bukan tenggelam sebagai 200.
-      console.error(`${LOG} gagal untuk ${today}: ${outcome.reason}`)
-      return NextResponse.json(
-        { date: today, status: 'failed', reason: outcome.reason },
-        { status: 500 },
-      )
-  }
+  // PARALEL, bukan berurutan: tiap panggilan POST /time bertimeout 8 detik (TIME_REQUEST_TIMEOUT_MS)
+  // sementara fungsi serverless Vercel punya anggaran waktunya sendiri. Dua alamat berurutan sudah
+  // menghabiskan 16 detik pada kasus terburuk dan fungsinya dimatikan sebelum sempat menulis ke DB.
+  // Tiap alamat menulis BARIS yang berbeda, jadi tak ada yang perlu diserialkan.
+  const results = await Promise.all(
+    addressIds.map(async (addressId) => ({
+      addressId,
+      outcome: await ensurePickupForDate(today, addressId),
+    })),
+  )
+
+  const items = results.map(({ addressId, outcome }) => ({
+    addressId,
+    status: outcome.status,
+    ...(outcome.status === 'failed' ? { reason: outcome.reason } : {}),
+    ...('pickup' in outcome ? { timeId: outcome.pickup.timeId } : {}),
+  }))
+
+  // SEBAGIAN gagal tetap 500: satu alamat tanpa slot berarti seluruh pesanan dari gudang itu jatuh
+  // ke fallback di jalur bayar. Menyembunyikannya di balik 200 membuat dasbor cron Vercel hijau
+  // untuk keadaan yang perlu ditangani hari itu juga.
+  const gagal = items.filter((i) => i.status === 'failed')
+  if (gagal.length > 0) {
+    console.error(
+      `${LOG} gagal untuk ${today} pada ${gagal.length}/${items.length} alamat: ${gagal
+        .map((i) => `${i.addressId}=${i.reason}`)
+        .join(', ')}`,
+    )
+    return NextResponse.json({ date: today, status: 'failed', items }, { status: 500 })
+  }
+
+  // Minggu: seluruh alamat sama-sama dilewati — bukan kesalahan.
+  if (items.every((i) => i.status === 'skipped-non-pickup-day')) {
+    console.log(`${LOG} ${today} bukan hari pickup — dilewati`)
+    return NextResponse.json({ date: today, status: 'skipped', reason: 'BUKAN_HARI_PICKUP' })
+  }
+
+  return NextResponse.json({ date: today, status: 'ok', items })
 }
```

> Jam cron tidak perlu diubah. `vercel.json` `0 23 * * 0-5` = 06:00 WIB, sementara `PICKUP_TIME_HHMM` (di `src/lib/pickup-schedule.ts`) bernilai sore — jaraknya jauh di atas syarat **minimal 90 menit dari sekarang** yang berlaku untuk `POST /time`. Yang perlu diingat: syarat 90 menit itu juga mengenai **jalur fallback saat checkout**; pesanan yang masuk kurang dari 90 menit sebelum jam pickup untuk tanggal yang slotnya belum ada akan ditolak Mengantar (`http-error`), dan sekarang penolakan itu bisa terjadi **per alamat**.

### 3c. Migration — fase B (SETELAH kode di 3b live)

File baru: `supabase/migrations/20260922120200_pickup_address_id_wajib.sql`
```sql
-- supabase/migrations/20260922120200_pickup_address_id_wajib.sql
-- Fase B dari 20260922120100: mencabut jembatan untuk kode lama.
--
-- DEFAULT alamat lama ada hanya selama kode lama (yang menulis insert tanpa address_id) masih
-- berjalan. Setelah kode baru live, default itu berubah sifat menjadi JEBAKAN: satu bug yang lupa
-- mengirim address_id tidak akan gagal, ia akan diam-diam menulis slot atas nama alamat yang salah.
--
-- PRASYARAT — jalankan ini dulu, harus 0:
--   select count(*) from public.mengantar_daily_pickup where address_id is null;

alter table public.mengantar_daily_pickup alter column address_id drop default;
alter table public.mengantar_daily_pickup alter column address_id set not null;
```

### Verifikasi sebelum lanjut
1. `npm run lint && npm run typecheck` (typecheck akan menemukan setiap pemanggil `getPickupByDate`/`savePickup`/`ensurePickupForDate`/`getTodayPickupTimeId` yang belum diperbarui — biarkan ia yang jadi daftar periksa Anda).
2. Picu cron lokal dengan `MENGANTAR_BASE_URL=https://sandbox.mengantar.com`:
```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/mengantar-pickup
```
Respons harus memuat `items` sepanjang **2**, masing-masing dengan `addressId` berbeda dan `timeId` terisi.
3. DB:
```sql
select date, address_id, time_id, created_at
from public.mengantar_daily_pickup
where date = current_date order by address_id;
```
Harus **dua baris, `address_id` berbeda, `time_id` berbeda**.
4. Idempotensi: panggil cron sekali lagi → `status` tiap item menjadi `existing`, dan **jumlah baris di DB tidak bertambah**. Ini penting karena Mengantar terbukti **tidak** men-dedupe berdasarkan tanggal (`docs/checkout-flow.md:329-331`).

### Kalau langkah ini dikerjakan tanpa langkah 1
`listPickupAddressIds()` membaca kolom yang belum ada → `readWarehouses` menangkap `42703` sebagai "skema belum di-migrate" dan mengembalikan array kosong (`mock-db/warehouses.ts:15,96-100`), sehingga daftar alamat jatuh ke env dan Anda kembali ke satu slot per tanggal — perubahan besar tanpa satu pun manfaat, dan tanpa error yang menjelaskan kenapa.

### Kalau langkah ini dikerjakan tanpa langkah 2
Tidak ada yang rusak secara teknis; slot tetap benar. Hanya kutipan harganya yang masih ditambal env.

### Rollback
```sql
-- Balikkan ke satu slot per tanggal. HAPUS dulu baris alamat non-lama, kalau tidak unique(date)
-- akan ditolak karena sudah ada dua baris untuk tanggal yang sama.
delete from public.mengantar_daily_pickup where address_id <> '<ALAMAT_LAMA>';
drop index if exists public.mengantar_daily_pickup_date_address_idx;
alter table public.mengantar_daily_pickup add constraint mengantar_daily_pickup_date_key unique (date);
alter table public.mengantar_daily_pickup alter column address_id drop not null;
```
Lalu `git revert` commit kode. Slot yang sudah terbuat di Mengantar boleh ditinggalkan — ia hanya slot kosong, tak berbiaya.

---

## LANGKAH 4 — Booking memakai alamat gudang pemenuh

**Tujuan.** `POST /order` mengirim `pickup.address_id` milik gudang yang benar-benar memenuhi pesanan, bukan satu alamat dari env.

**Kenapa setelah 3.** Payload-nya membawa `address_id` **dan** `time_id` bersama-sama. Tanpa langkah 3, `getTodayPickupTimeId` hanya punya satu slot dan Anda akan mengirim alamat Surabaya berpasangan dengan slot Cengkareng.

**Besarnya perubahan.** 1 file kode, **tanpa migration**. Langkah terkecil — dan langkah yang benar-benar mengubah ke mana kurir datang.

### Kode — `src/lib/mengantar-shipment.ts`

**baris 43-48** (import):
```diff
 import { JT_COURIER_ID } from '@/lib/mengantar-estimate'
 import { mengantarWriteHost } from '@/lib/mengantar-host'
 import { getTodayPickupTimeId } from '@/lib/mengantar-pickup'
 import { readProducts } from '@/lib/mock-db/products'
 import { shippingWeightKg } from '@/lib/shipping-weight'
+import { getPickupAddressIdForWarehouse } from '@/lib/warehouse'
 import type { Order } from '@/types/order'
```

**baris 200-204:**
```diff
   const key = process.env.MENGANTAR_API_KEY
-  const addressId = process.env.MENGANTAR_STORE_ADDRESS_ID
+  // Alamat penjemputan = milik GUDANG PEMENUH pesanan ini (orders.warehouse_id), bukan satu alamat
+  // global. Inilah satu-satunya field yang menentukan dari mana kurir mengambil paket DAN dari mana
+  // Mengantar menagih ongkirnya — `POST /order` tak punya field origin sama sekali.
+  //
+  // Pesanan LAMA (warehouse_id NULL, dibuat sebelum sistem multi-gudang) dan gudang yang belum
+  // didaftarkan alamatnya tetap terlayani: getPickupAddressIdForWarehouse jatuh ke
+  // MENGANTAR_STORE_ADDRESS_ID. Fallback itu BUKAN sisa yang bisa dibersihkan — tanpanya, pesanan
+  // warisan yang baru dibayar akan gagal dibooking padahal uangnya sudah masuk.
+  const addressId = await getPickupAddressIdForWarehouse(order.warehouseId)
   if (!key || !addressId) {
     return { ok: false, reason: 'not-configured', detail: 'env Mengantar belum lengkap' }
   }
```

**baris 219-223:**
```diff
-  // Slot penjemputan. Tanpa time_id, `scheduledPickup` tak bisa dipakai.
-  const pickup = await getTodayPickupTimeId()
+  // Slot penjemputan MILIK ALAMAT DI ATAS. Tanpa time_id, `scheduledPickup` tak bisa dipakai.
+  // Slot alamat lain tak boleh dipinjam: paketnya akan terdaftar pada penjemputan di gudang
+  // yang berbeda dari tempat barangnya benar-benar berada.
+  const pickup = await getTodayPickupTimeId(addressId)
   if (!pickup) {
     return { ok: false, reason: 'no-pickup-time', detail: 'time_id pickup tak tersedia' }
   }
```

**baris 250-252** (log — `address_id` bukan rahasia; yang rahasia adalah API key di dalam URL):
```diff
   console.log(
-    `${LOG} booking ${order.orderId}: kurir=${JT_COURIER_ID} berat=${weight}kg time_id=${pickup.timeId} (sumber ${pickup.source}, tanggal ${pickup.date})`,
+    `${LOG} booking ${order.orderId}: kurir=${JT_COURIER_ID} berat=${weight}kg gudang=${order.warehouseId ?? 'warisan/default'} address_id=${addressId} time_id=${pickup.timeId} (sumber ${pickup.source}, tanggal ${pickup.date})`,
   )
```

Perbarui juga komentar kontrak di header file (`mengantar-shipment.ts:12-20`): `address_id` kini berasal dari gudang, bukan env.

> `order.warehouseId` dijamin tersedia di jalur ini: `getOrderByOrderId` memakai `select('*')` (`src/lib/mock-db/orders.ts:570-576`) dan memetakan `row.warehouse_id → order.warehouseId` (baris 338-339). Webhook Xendit mengirim `updated` — hasil baca ulang setelah status berubah (`src/app/api/webhooks/xendit/route.ts:246-250`) — jadi nilainya sudah terkini.

### Verifikasi sebelum lanjut
1. `npm run lint && npm run typecheck`.
2. Dengan `MENGANTAR_BASE_URL=https://sandbox.mengantar.com` di lokal, buat dua pesanan uji yang **gudang pemenuhnya berbeda** (paling mudah: kosongkan stok satu produk di salah satu gudang lewat OMS → Gudang → Kelola Stok, sehingga hanya gudang lain yang layak), lalu picu `POST /api/dev/simulate-payment` untuk masing-masing.
3. Cocokkan log: baris `[mengantar-shipment] booking INV-…` harus menunjukkan **`address_id` yang berbeda** untuk kedua pesanan, dan `time_id` yang berbeda pula.
4. Buka dashboard Mengantar (sandbox) → daftar penjemputan: dua penjemputan, dua alamat.
5. Cek pesanan warisan: ambil satu invoice yang `warehouse_id`-nya NULL (kalau ada di data uji) dan pastikan lognya berbunyi `gudang=warisan/default` dengan `address_id` = nilai env — bukan gagal.

### Kalau langkah ini dikerjakan tanpa langkah 3
`getTodayPickupTimeId(addressId)` belum menerima parameter → galat kompilasi (tertangkap `npm run typecheck`, jadi tak akan pernah sampai produksi). Kalau dipaksa tanpa perubahan pickup: alamat benar, slot salah — dan itu kesalahan yang **tidak memunculkan error**, hanya kurir yang datang ke tempat yang salah.

### Kalau langkah ini dikerjakan tanpa langkah 1
`getPickupAddressIdForWarehouse` selalu jatuh ke env → perilaku persis seperti sekarang. Tidak rusak, tapi juga tidak berubah.

### Rollback
`git revert` commit ini saja. Tidak ada state DB yang perlu dibalik; langkah 3 boleh tetap berdiri (slot ekstra untuk alamat kedua hanya menganggur, tidak mengganggu).

---

## LANGKAH 5 — Cabut `MENGANTAR_PICKUP_ORIGIN_ID`

**Tujuan.** Mengembalikan kutipan ongkir ke origin per gudang, sehingga pemilihan gudang kembali berbasis ongkir riil — dan kini tagihannya ikut mengikuti, karena tiap gudang punya alamat pickup sendiri.

**Kenapa paling akhir.** Env ini adalah penambal. Mencabutnya sebelum 1–4 selesai berarti melepas penambal tanpa perbaikan di bawahnya: kutipan langsung memakai origin per gudang sementara tagihan masih dari satu alamat.

**Besarnya perubahan.** 2 file kode + 4 dokumen + 2 file test (komentar) + env di 2 tempat. **Tanpa migration.**

### 5a. Pra-syarat yang WAJIB lulus lebih dulu
```sql
-- Harus mengembalikan 0 baris. Gudang aktif tanpa alamat pickup = gudang yang dikutip dari
-- origin-nya sendiri tapi ditagih dari alamat env: bug yang persis ini hendak ditutup.
select id, nama, mengantar_origin_id, mengantar_address_id
from public.warehouses
where is_active and (mengantar_address_id is null or btrim(mengantar_address_id) = '');
```
Juga: langkah 2 sudah diverifikasi untuk **kedua** gudang, dan langkah 4 sudah berjalan minimal satu siklus penuh di produksi.

### 5b. Kode

**`src/lib/warehouse.ts:123-145`** — ganti seluruh blok:
```diff
-// === Origin KUTIPAN ongkir (boleh berbeda dari origin gudang) ===
-
-// Origin yang dipakai untuk MENGUTIP ongkir ke pembeli.
-//
-// Kenapa terpisah dari getOriginIdForWarehouse: `POST /order` Mengantar TIDAK punya field origin
-// sama sekali — biaya kirim dihitung dari `pickup.address_id`, yaitu satu alamat penjemputan milik
-// akun (MENGANTAR_STORE_ADDRESS_ID). Selama akun cuma punya SATU alamat pickup, mengutip dari origin
-// per-gudang membuat pembeli melihat harga rute yang tak pernah dipakai:
-//   INV-20260820-4876 — dikutip Surabaya→Kemayoran Rp18.000, ditagih Cengkareng→Kemayoran Rp25.000.
-//   Selisihnya keluar dari saldo Mengantar dan tak tercatat di pesanan mana pun.
-//
-// MENGANTAR_PICKUP_ORIGIN_ID = _id kelurahan alamat pickup tersebut. Bila di-set, SELURUH kutipan
-// memakai origin ini sehingga harga yang dilihat pembeli = harga yang benar-benar ditagih.
-// Konsekuensi yang disengaja: semua gudang berharga sama, jadi pemilihan gudang tak lagi berbasis
-// ongkir — pemenangnya cukup gudang ber-stok (deterministik lewat resolveWarehouseForOrder).
-//
-// Kosong → perilaku lama (origin per gudang). Cabut env ini setelah tiap gudang punya alamat pickup
-// sendiri di Mengantar (lihat ROADMAP.md → kolom warehouses.mengantar_address_id).
-export async function getQuoteOriginId(warehouseId?: string): Promise<string> {
-  const pinned = process.env.MENGANTAR_PICKUP_ORIGIN_ID?.trim()
-  if (pinned) return pinned
-  return getOriginIdForWarehouse(warehouseId)
-}
+// === Origin KUTIPAN ongkir ===
+
+// Origin yang dipakai untuk MENGUTIP ongkir ke pembeli.
+//
+// SEJARAH (jangan dihidupkan lagi): sampai 2026-09-22 fungsi ini dipaku ke env
+// MENGANTAR_PICKUP_ORIGIN_ID. `POST /order` Mengantar tak punya field origin — biaya kirim dihitung
+// dari `pickup.address_id` — dan selama akun cuma punya SATU alamat pickup, mengutip dari origin
+// per gudang membuat pembeli melihat harga rute yang tak pernah dipakai:
+//   INV-20260820-4876 — dikutip Surabaya→Kemayoran Rp18.000, ditagih Cengkareng→Kemayoran Rp25.000.
+// Env itu menutup selisihnya dengan harga: semua gudang jadi berharga sama, sehingga pemilihan
+// gudang berhenti berbasis ongkir.
+//
+// Sekarang tiap gudang punya alamat pickup sendiri (warehouses.mengantar_address_id) dan booking
+// memakai alamat gudang pemenuh, jadi origin per gudang KEMBALI menjadi jawaban yang benar —
+// sekaligus jawaban yang ditagih.
+//
+// PENJAGA: gudang tanpa alamat pickup dikembalikan sebagai string kosong sehingga
+// resolveShippingOptions MEMBUANGNYA dari perbandingan. Kalau ia tetap dikutip, harganya berasal
+// dari origin gudang itu tapi tagihannya dari alamat env — tepat bug yang baru saja ditutup,
+// kembali lewat pintu belakang. Lebih baik satu gudang tak muncul sebagai pilihan (pembeli tetap
+// dilayani gudang lain) daripada muncul dengan harga yang tak akan pernah ditagihkan.
+export async function getQuoteOriginId(warehouseId?: string): Promise<string> {
+  const warehouse = warehouseId ? await getWarehouseById(warehouseId) : await getDefaultWarehouse()
+  if (!warehouse?.mengantarAddressId?.trim()) return ''
+  return getOriginIdForWarehouse(warehouse.id)
+}
```

> **Varian lunak**, kalau Anda belum nyaman dengan penjaga di atas (mis. baru satu gudang yang terdaftar): buang tiga baris penjaga dan cukup tulis `return getOriginIdForWarehouse(warehouseId)`. Konsekuensinya gudang tanpa alamat tetap dikutip dari origin-nya sendiri tapi ditagih dari alamat env. Pilih varian ini HANYA sementara, dan hanya bila query pra-syarat 5a belum 0 baris.
>
> ⚠️ Risiko yang harus disadari pada varian penjaga: bila **semua** gudang kehilangan alamat (mis. tertimpa `null` lewat OMS — lihat peringatan di langkah 1c), `byOrigin` di `warehouse-shipping.ts:189-196` menjadi kosong → `options` kosong → checkout menampilkan "belum ada kurir" untuk **semua** pembeli. Karena itu query 5a layak dijadikan pemeriksaan rutin, bukan sekali jalan.

**`src/lib/warehouse-shipping.ts:134-139`** — komentar yang menyebut env sudah tak berlaku:
```diff
 // Kunci pemanggilan = origin, bukan gudang: beberapa gudang bisa berbagi kelurahan asal (dan SELALU
-// begitu ketika MENGANTAR_PICKUP_ORIGIN_ID di-set), sedangkan tarif Mengantar hanya bergantung pada
-// origin+tujuan+berat. Satu panggilan per origin, bukan per gudang.
+// begitu ketika dua gudang berada di kelurahan yang sama), sedangkan tarif Mengantar hanya
+// bergantung pada origin+tujuan+berat. Satu panggilan per origin, bukan per gudang.
```

**`src/app/api/mengantar/shipping/estimate/route.ts:56`** — komentar menyebut env yang sudah dicabut; perbarui menjadi "origin kutipan = origin gudang (getQuoteOriginId)".

### 5c. Cabut env & perbarui dokumen
1. **Vercel** → Settings → Environment Variables → hapus `MENGANTAR_PICKUP_ORIGIN_ID` di **semua** environment (Production, Preview, Development).
2. **`.env.local`** → hapus barisnya.
3. **`CLAUDE.md:835-847`** → hapus seluruh blok `MENGANTAR_PICKUP_ORIGIN_ID`. Di blok `MENGANTAR_STORE_ADDRESS_ID` (`:832-834`), ubah keterangannya menjadi **fallback** untuk pesanan warisan & gudang tanpa alamat, bukan alamat tunggal.
4. **`docs/checkout-flow.md:366-402`** → judul bagian `Origin gudang vs alamat pickup — BELUM selaras` menjadi `— SELARAS (alamat pickup per gudang)`; tabel di `:368-371` diisi alamat pickup masing-masing gudang; sub-bagian `Penyelarasan sekarang: MENGANTAR_PICKUP_ORIGIN_ID` (`:378-402`) diganti penjelasan skema baru. Bagian jadwal pickup (`:255-300`) juga perlu menyebut `address_id` pada tabel dan pada contoh `POST /time`.
5. **`ROADMAP.md:86`** → pindahkan baris "Alamat pickup per gudang" dari tabel "yang belum" ke daftar selesai (pola `ROADMAP.md:203` memakai `- [x]`).
6. **`docs/warehouse.md:23-41`** → daftar "yang harus diisi admin" bertambah: `mengantar_address_id` per gudang; dan daftar kolom tabel `warehouses` (`:35-36`) ditambah kolom baru.
7. **`tests/e2e/checkout-ongkir-flow.spec.ts:11,198`** dan **`tests/e2e/checkout-full-payment-flow.spec.ts:93`** → komentar/asersi yang berasumsi "asal kutipan selalu Cengkareng" tidak lagi benar. Playwright **tidak** dijalankan CI (disengaja), jadi ini tidak akan menggagalkan PR — justru sebabnya harus diperiksa manual, kalau tidak test-nya membusuk diam-diam.

### Verifikasi
1. `npm run lint && npm run typecheck && npm audit --audit-level=high` (tiga perintah CI).
2. `grep -rn "MENGANTAR_PICKUP_ORIGIN_ID" .` → hanya boleh tersisa di catatan sejarah (komentar `warehouse.ts`, `docs/checkout-flow.md`), tidak ada lagi `process.env.MENGANTAR_PICKUP_ORIGIN_ID`.
3. Checkout ke satu tujuan dengan produk yang **ada stoknya di kedua gudang**: `POST /api/mengantar/shipping/options` harus mengembalikan opsi J&T dengan `warehouseId` **gudang termurah** — dan harganya harus berbeda antar gudang lagi (dengan host produksi; di sandbox perbandingannya terbalik, lihat `docs/checkout-flow.md:360-364`).
4. **Uji penutup yang sesungguhnya**: satu pesanan nyata sampai dibooking, lalu bandingkan `ongkir` yang dikutip ke pembeli dengan biaya di dashboard Mengantar. **Harus sama.** Lakukan sekali untuk tiap gudang. Ini satu-satunya bukti bahwa seluruh rangkaian lima langkah berhasil.

### Kalau langkah ini dikerjakan tanpa langkah 1–4
Kembali ke keadaan sebelum env ini ada: pembeli dikutip tarif Surabaya, ditagih tarif Cengkareng, selisihnya keluar dari saldo Mengantar tanpa jejak di tabel `orders` (kolom ongkir aktual memang belum ada — `ROADMAP.md:87`). Inilah satu-satunya urutan yang benar-benar tidak boleh dibalik.

### Rollback
Paling murah dari seluruh panduan: **set kembali `MENGANTAR_PICKUP_ORIGIN_ID=5fc62f5ff8f44b34aa4c0dbc` di Vercel**, lalu `git revert` perubahan `warehouse.ts`. Tanpa revert kode, env saja tidak cukup — versi baru `getQuoteOriginId` tidak membacanya lagi. Karena itu, kalau ingin tuas darurat tanpa redeploy, pertahankan cabang `pinned` di baris 142-143 selama satu-dua minggu masa pantau dan baru hapus setelah verifikasi poin 4 di atas lulus untuk kedua gudang.

---

## DAFTAR BACKWARD-COMPATIBILITY (periksa tiap langkah)

| Keadaan | Harus tetap jalan karena | Dijaga oleh |
|---|---|---|
| `orders.warehouse_id` **NULL** (pesanan sebelum multi-gudang) lalu dibayar | uangnya sudah masuk; booking gagal = paket tak pernah dikirim | `getPickupAddressIdForWarehouse(undefined)` → gudang default → fallback `MENGANTAR_STORE_ADDRESS_ID`. **Env ini TIDAK ikut dicabut di langkah 5.** |
| Gudang aktif dengan `mengantar_address_id` **NULL** | bisa terjadi kapan saja: gudang baru dibuat dari OMS tanpa alamat | Booking jatuh ke env (langkah 4). Kutipan: gudang itu **dibuang** dari perbandingan (penjaga langkah 5b) → pembeli tetap dilayani gudang lain |
| `mengantar_address_id` tertimpa `null` oleh penyimpanan gudang dari OMS | `inputToRow` menulis seluruh kolom sekaligus | Dicegah dengan **tidak** memasukkan field ini ke `WarehouseInput`/`inputToRow` (langkah 1c). Kalau nanti dimasukkan, form OMS **wajib** ikut mengirimnya |
| Migration gudang belum di-apply sama sekali | kode lama harus tetap hidup | `isMissingWarehouseSchema` (`mock-db/warehouses.ts:15,18-20`) menangkap `42703` (kolom tak ada) → `readWarehouses` mengembalikan `[]` → semua jalur jatuh ke env |
| Baris `mengantar_daily_pickup` lama tanpa `address_id` | cron & checkout membacanya tiap hari | Backfill + `DEFAULT` di migration fase A; `NOT NULL` baru dipasang di fase B setelah kode live |
| Penyapu pesanan kedaluwarsa | `readExpiredPendingInvoices` (`orders.ts:761-783`) memfilter `.not('warehouse_id','is',null)` di baris **772** | **Tidak disentuh panduan ini dan tidak boleh disentuh.** Alasannya ada di komentar baris 744-758: pesanan warisan tak punya bukti stoknya pernah dipotong dari gudang mana pun, jadi menyapunya akan mengkreditkan stok ke gudang default yang mungkin tak pernah dikurangi → oversell. Pesanan warisan tetap dikerjakan manusia |
| `readCancelledWithPendingPayment` (`orders.ts:798-810`) **menyertakan** pesanan warisan | di situ tak ada stok yang bergerak, murni pembukuan (komentar baris 791-794) | Tidak disentuh |
| `MENGANTAR_PICKUP_TIME_ID` (slot statis lapis terakhir) | dipertahankan sebagai jaring pengaman saat Mengantar & DB sama-sama bermasalah | Dibatasi ke alamat pemiliknya saja (langkah 3b). **Perlu dikonfirmasi**: apakah `POST /order` menolak `time_id` milik alamat lain. Sampai terbukti menolak, pembatasan ini yang menjaga |
| Mode `single` (`store_settings.warehouse_mode`) | tuas rollback darurat, berlaku seketika tanpa redeploy | Tetap utuh: hanya gudang default yang dipertimbangkan, dan gudang default punya alamatnya sendiri |
| Env `MENGANTAR_ORIGIN_ID` / `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID` | fallback berjenjang di `getOriginIdForWarehouse:115-120` | Tidak disentuh |

---

## URUTAN DEPLOY YANG AMAN (Vercel men-deploy dari `git push`)

**Aturan umum di repo ini: MIGRATION DULU, KODE BELAKANGAN.** Dasarnya bukan preferensi — `readWarehouses` memakai `select('*')`, jadi kolom yang **ada tapi belum dibaca kode** sama sekali tidak berbahaya, sedangkan kode yang **membaca/menulis kolom yang belum ada** langsung gagal. Migration yang mendahului kode punya jendela aman selebar apa pun; sebaliknya tidak.

| # | Tindakan | Di mana | Catatan |
|---|---|---|---|
| 1 | Migration `20260922120000_warehouses_mengantar_address_id.sql` | SQL Editor | Additive murni, nol dampak |
| 2 | `curl` `POST /address` (sandbox **dan** produksi) + `UPDATE warehouses` | manual | Belum ada kode yang membacanya |
| 3 | Langkah 2 (`PUT /address` / penyelarasan origin) | manual | Belum ada kode yang terpengaruh |
| 4 | Migration `20260922120100_pickup_slot_per_alamat.sql` (fase A) | SQL Editor | **Harus sebelum push kode langkah 3.** `DEFAULT` + `UNIQUE(date,address_id)` membuat kode LAMA yang masih live tetap sah |
| 5 | Push kode langkah 1c + 3b + 4 **dalam SATU deploy** | git push → Vercel | Wajib satu deploy: tanda tangan `getTodayPickupTimeId` berubah, jadi `mengantar-pickup.ts` dan `mengantar-shipment.ts` tidak boleh berbeda versi |
| 6 | Amati satu siklus cron penuh + minimal satu booking per gudang | produksi | Kalau ada yang salah, berhenti di sini — langkah 5 belum dijalankan, penambal env masih aktif |
| 7 | Migration `20260922120200_pickup_address_id_wajib.sql` (fase B) | SQL Editor | Jalankan **setelah** query `address_id is null` mengembalikan 0 |
| 8 | Push kode langkah 5 + hapus env di Vercel | git push + dashboard | **Hapus env DULU atau bersamaan**, jangan setelahnya — kode baru mengabaikan env, jadi urutan di sini hanya soal kerapian, bukan keselamatan |
| 9 | Verifikasi kutipan-vs-tagihan untuk kedua gudang | manual | Bukti penutup |

**Jendela berbahaya yang perlu diketahui** (antara #4 dan #5, biasanya beberapa menit): kode lama masih memanggil `getPickupByDate(date)` **tanpa** filter alamat dengan `.maybeSingle()`. Selama di jendela itu hanya ada baris untuk satu alamat, `maybeSingle()` aman. Ia baru galat kalau ada dua baris bertanggal sama — dan baris kedua hanya bisa dibuat oleh kode BARU. Karena itu: **jangan jalankan cron manual, dan jangan mengisi slot alamat kedua lewat SQL, di antara #4 dan #5.**

**Jangan gabungkan langkah 5 ke deploy yang sama dengan 1–4.** Langkah 1–4 seluruhnya aditif dan bisa dibalik tanpa menyentuh harga yang dilihat pembeli. Langkah 5 mengubah angka di layar checkout. Memisahkannya berarti kalau ada yang aneh pada harga, Anda tahu persis deploy mana yang menyebabkannya.

---

## RINGKASAN BESARNYA PERUBAHAN

| Langkah | File kode | Migration | Panggilan API manual | Risiko |
|---|---|---|---|---|
| 1 — daftar alamat + kolom | 3 (`types/warehouse.ts`, `mock-db/warehouses.ts`, `warehouse.ts`) | 1 (aditif) | `GET /address`, `GET /address/search`, `POST /address` ×1–2, per host | Rendah — jalur baca saja |
| 2 — selaraskan `PICKUP_AUTOFILL` | 0 | 0 | `PUT /address/{id}` bila perlu | Rendah — data saja |
| 3 — slot per alamat | 4 (`mock-db/pickup.ts`, `mengantar-pickup.ts`, `warehouse.ts`, cron route) | 2 (fase A + B) | tak ada (lewat cron) | **Tertinggi** — ganti unique constraint + tanda tangan fungsi berubah |
| 4 — booking pakai alamat gudang | 1 (`mengantar-shipment.ts`) | 0 | tak ada | Sedang — mengubah ke mana kurir datang |
| 5 — cabut env | 2 kode + 4 dokumen + 2 test | 0 | tak ada | Sedang — mengubah harga yang dilihat pembeli; rollback paling murah |

---

## HAL YANG "PERLU DIKONFIRMASI" (jangan diasumsikan)

1. **Apakah `POST /order` menolak pasangan `address_id` + `time_id` yang tidak cocok?** Dokumentasi tidak menyatakannya. Kalau ia menerima diam-diam, satu-satunya penjaga adalah kode kita. Uji di sandbox: kirim booking dengan `address_id` gudang A dan `time_id` slot gudang B; catat responsnya.
2. **Bentuk respons `GET /time`** tidak memuat `address_id` pada contoh dokumentasi — itulah dasar keputusan menyimpan pemetaan sendiri. Kalau ternyata respons sungguhan membawanya, keputusan ini tetap benar (kolom DB lebih murah daripada satu panggilan API), tapi alasannya berubah.
3. **Perilaku `PUT /address/{id}` terhadap alamat yang sudah punya slot pickup aktif** — apakah slot lama ikut berpindah kelurahan, atau tetap memakai zona lama? Kalau tak yakin, lakukan `PUT` di luar jam operasional dan periksa slot esok harinya.
4. **Batas jumlah alamat per akun Mengantar** — tidak disebut dokumentasi. Untuk dua alamat tidak relevan, tapi catat sebelum menambah gudang ketiga.
5. **Nama constraint `mengantar_daily_pickup_date_key`** — itu nama bawaan Postgres untuk `unique` inline. Verifikasi dulu sebelum menjalankan `DROP`:
   ```sql
   select conname from pg_constraint
   where conrelid = 'public.mengantar_daily_pickup'::regclass and contype = 'u';
   ```

---

### Catatan gaya yang diikuti panduan ini
Komentar di repo ini menjelaskan **kenapa**, bukan apa: kerap memuat bukti terukur (angka tarif, nomor invoice, tanggal kejadian), menyebut kegagalan yang pernah terjadi, dan menandai mana yang "disengaja" agar tidak "diperbaiki" orang berikutnya (mis. `warehouse.ts:10-17`, `mengantar-host.ts:55-71`, `orders.ts:744-758`). Setiap diff di atas ditulis mengikuti pola itu — termasuk mempertahankan catatan sejarah `MENGANTAR_PICKUP_ORIGIN_ID` di langkah 5 alih-alih menghapusnya, supaya alasan env itu pernah ada tidak hilang bersama env-nya.

**Tidak ada file yang diubah** — ini murni panduan.
