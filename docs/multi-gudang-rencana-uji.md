# RENCANA PENGUJIAN — Dua Alamat Pickup Terverifikasi di Mengantar (satu per gudang)

Disusun setelah membaca kode aktual. Tidak ada file yang diubah.

---

## 0. Yang perlu disiapkan sekali, sebelum tahap A

### 0.1 Lembar catatan (isi dulu, dipakai di seluruh rencana)

Buat catatan kecil (notepad/Notion) berisi nilai-nilai ini. Hampir semua langkah di bawah menyebutnya dengan nama simbolik:

| Simbol | Artinya | Cara dapat |
|---|---|---|
| `W_SBY` | uuid "Gudang Utama Infarm" | query A0 |
| `W_JKT` | uuid "Gudang Jakarta" | query A0 |
| `ORIGIN_SBY` | `warehouses.mengantar_origin_id` Gudang Utama (Keputih/Sukolilo) | query A0 |
| `ORIGIN_JKT` | `warehouses.mengantar_origin_id` Gudang Jakarta (Cengkareng) | query A0 |
| `ADDR_SBY` | `_id` alamat pickup Surabaya di Mengantar | A1 |
| `ADDR_JKT` | `_id` alamat pickup Cengkareng di Mengantar (nilai `MENGANTAR_STORE_ADDRESS_ID` sekarang) | A1 |
| `DEST_JKT` | `destination_id` alamat uji di Jakarta (pakai **Kemayoran**, sama dengan insiden INV-20260820-4876) | pencarian alamat di halaman checkout |
| `DEST_SBY` | `destination_id` alamat uji di Surabaya (mis. Gubeng) | idem |
| `PROD_NONVAR` | satu produk **TANPA varian**, berat terisi (bukan "Belum diisi") | query A0b |

### 0.2 Query A0 — potret awal gudang

```sql
select id, nama, mengantar_origin_id, mengantar_address_id, is_default, is_active
from public.warehouses
order by is_default desc, nama;
```

> `mengantar_address_id` **belum ada** hari ini (perubahan #1). Sebelum migration dijalankan, query ini akan galat `column ... does not exist` — itu normal dan justru bukti migration belum jalan. Buang kolom itu dari select untuk potret pra-migration.

### 0.2b Query A0b — memilih produk uji non-varian

```sql
select p.id, p.nama, p.berat, p.stock,
       (select count(*) from public.product_variants v where v.product_id = p.id) as jml_varian
from public.products p
where p.berat is not null and p.berat > 0
order by jml_varian, p.nama;
```
Ambil baris dengan `jml_varian = 0`. **Wajib non-varian** — lihat G4: RPC 22-parameter tidak menyentuh stok per gudang untuk produk bervarian.

### 0.3 Tiga jebakan lingkungan yang akan merusak hasil kalau diabaikan

**(a) Sandbox membalik urutan harga.** `docs/checkout-flow.md` mencatat: di sandbox Gudang Utama (Surabaya) tampak ±Rp19k dan Gudang Jakarta ±Rp26k, sedangkan di produksi justru Rp11.200 vs Rp8.000. Jadi **jangan menetapkan "gudang termurah yang diharapkan" dari asumsi geografis.** Tahap B mengukur angkanya dulu; tahap C hanya memeriksa bahwa yang menang = yang termurah **menurut angka B**, apa pun itu. Catat di lembar: `HOST = sandbox | produksi`.

**(b) Penjaga host tulis.** `mengantarWriteHost()` (`src/lib/mengantar-host.ts:106`) menolak penulisan ke host produksi (`*.app.mengantar.com`) dari deployment non-produksi. Artinya seluruh uji yang **menulis** (POST /time di tahap F, POST /order di tahap D/E) harus dijalankan dari:
- deployment **produksi** Vercel bila `MENGANTAR_BASE_URL` = produksi, atau
- lokal/preview bila `MENGANTAR_BASE_URL` = sandbox.
Gejala kalau salah: hasil `{ ok: false, reason: 'blocked-environment' }` dan log `booking ... DIBATALKAN`.

**(c) Rate limit.** `ORDER_CREATE_IP = 3 permintaan/menit/IP` (`src/lib/rate-limit.ts:107`). Uji dua HP bersamaan (G3) **wajib** pakai dua data seluler berbeda; jangan dua-duanya di WiFi yang sama.

### 0.4 Satu hal yang harus dipahami sebelum tahap C

Respons `POST /api/mengantar/shipping/options` ke browser sudah lewat `cheapestPerCourier()` (`route.ts:86`). Karena kurir yang di-whitelist cuma J&T, **pembeli hanya pernah melihat SATU baris J&T** — yang termurah. Konsekuensinya:

- Dari UI saja kamu **tidak bisa** melihat gudang mana yang menang. Verifikasi gudang dilakukan di **DevTools → Network → options → Response**, field `options[0].warehouseId` dan `options[0].warehouseName`.
- Daftar lengkap (dua gudang) tetap ada di cache server dan dipakai `orders/create` sebagai fallback.

---

## A. Verifikasi prasyarat — dua alamat benar-benar terdaftar & aktif

### A1 — Membuktikan akun Mengantar punya DUA alamat pickup

**Prasyarat:** `MENGANTAR_API_KEY` di tangan. Alamat gudang Surabaya sudah didaftarkan (lewat dashboard Mengantar atau `POST /api/public/{KEY}/address`).

**Langkah:**
1. Panggil `GET https://{HOST}/api/public/{KEY}/address` (browser atau Postman). **Jangan tempel URL ini ke mana pun** — API key ada di dalam path.
2. Salin seluruh respons ke lembar catatan.

**Hasil yang diharapkan:** respons berupa **ARRAY berisi minimal 2 objek**. Tiap objek punya `_id`, `PICKUP_NAME`, `PICKUP_ADDRESS`, `PICKUP_PIC`, `PICKUP_PIC_PHONE`, `PICKUP_ORIGIN_CODE`, `PICKUP_DESTINATION_CODE`, `PICKUP_SAP_CODE`.
- Objek Cengkareng: `PICKUP_ADDRESS` memuat "Jl Melati no 9", `_id` = nilai `MENGANTAR_STORE_ADDRESS_ID` yang dipakai sekarang → ini `ADDR_JKT`.
- Objek Surabaya: alamat gudang Surabaya → ini `ADDR_SBY`.

**Kalau GAGAL:**
- Array cuma 1 elemen → alamat Surabaya belum terdaftar/masih draft. **Berhenti di sini**, tak ada gunanya melanjutkan.
- 403/401 → API key salah, atau key sandbox dipakai ke host produksi (dan sebaliknya).
- Alamat Surabaya muncul tapi tanpa `PICKUP_ORIGIN_CODE` → **perlu dikonfirmasi ke Mengantar**: apakah alamat baru butuh verifikasi manual sebelum kode originnya terbit.

### A2 — Kode origin tiap alamat berbeda, dan BUKAN kode yang sama

**Prasyarat:** hasil A1.

**Langkah:** bandingkan `PICKUP_ORIGIN_CODE` kedua objek.

**Hasil yang diharapkan:** `ADDR_JKT.PICKUP_ORIGIN_CODE` = `CGK10000` (seluruh kelurahan Cengkareng berbagi kode ini, tercatat di `docs/checkout-flow.md`), dan `ADDR_SBY.PICKUP_ORIGIN_CODE` = kode zona **Surabaya** yang berbeda.

**Kalau GAGAL:** kalau kedua kode **sama**, alamat Surabaya kemungkinan terdaftar dengan `PICKUP_AUTOFILL` kelurahan yang keliru (masih Jakarta). Seluruh tujuan perubahan ini batal — tarif akan tetap identik dari dua alamat. Perbaiki pendaftaran alamatnya dulu.

### A3 — `PICKUP_AUTOFILL` alamat = `mengantar_origin_id` gudangnya (perubahan #2)

Ini inti dari jaminan "dikutip = ditagih". Kutipan ongkir memakai `origin_id` (kelurahan, dari tabel `warehouses`); tagihan memakai `pickup.address_id`. Keduanya baru sinkron kalau kelurahan di balik alamat pickup = kelurahan di kolom origin.

**Prasyarat:** A1 selesai.

**Langkah:**
1. Catat `PICKUP_AUTOFILL` tiap alamat dari respons A1. *(Bila field ini tidak ikut dikembalikan di GET — **perlu dikonfirmasi ke Mengantar**; alternatifnya pakai `PICKUP_ORIGIN_CODE` sebagai pembanding zona, lihat catatan di A4.)*
2. Jalankan query A0 untuk melihat `mengantar_origin_id` tiap gudang.
3. Bandingkan berpasangan.

**Hasil yang diharapkan:**

| Gudang | `mengantar_origin_id` (DB) | `PICKUP_AUTOFILL` alamatnya |
|---|---|---|
| Gudang Utama Infarm | `ORIGIN_SBY` (Keputih/Sukolilo) | sama persis dengan `ORIGIN_SBY` |
| Gudang Jakarta | `ORIGIN_JKT` (Cengkareng) | sama persis dengan `ORIGIN_JKT` |

Kalau tidak sama persis, minimal **zona origin-nya identik** (A4).

**Verifikasi di Supabase (setelah migration #1 jalan):**
```sql
select nama, mengantar_origin_id, mengantar_address_id, is_default, is_active
from public.warehouses
where is_active
order by is_default desc;
```
Dua baris, keduanya `mengantar_address_id` terisi, tidak ada yang NULL, dan **tidak boleh kembar**:
```sql
-- harus mengembalikan 0 baris
select mengantar_address_id, count(*)
from public.warehouses
where is_active and mengantar_address_id is not null
group by 1 having count(*) > 1;
```

**Kalau GAGAL:** `mengantar_address_id` kembar = kedua gudang tetap dijemput di satu tempat (kondisi sekarang, cuma pindah dari env ke kolom). NULL = booking gudang itu akan gagal `not-configured` (lihat H3).

### A4 — Zona tarif kedua origin memang berbeda (uji tanpa menulis apa pun)

**Prasyarat:** `ORIGIN_SBY`, `ORIGIN_JKT`, `DEST_JKT`.

**Langkah:** panggil dua URL berikut di browser (tanpa API key, aman):
```
GET https://{HOST}/api/order/allEstimatePublic?origin_id={ORIGIN_JKT}&destination_id={DEST_JKT}&weight=1
GET https://{HOST}/api/order/allEstimatePublic?origin_id={ORIGIN_SBY}&destination_id={DEST_JKT}&weight=1
```
Catat `data.JT.estimatedSpecialPrice` dari masing-masing.

**Hasil yang diharapkan:** dua angka **berbeda**. Di produksi ke Kemayoran, yang dari `ORIGIN_JKT` harus jauh lebih murah (insiden lama: Rp18.000 vs ~Rp25.000). Di sandbox boleh terbalik — yang penting berbeda. Catat sebagai `P_JKT_1kg` dan `P_SBY_1kg`.

**Kalau GAGAL:** kalau kedua angka sama persis, tarif J&T untuk rute itu kebetulan seragam — ganti `DEST_JKT` ke tujuan lain yang lebih jauh dari salah satu origin. Kalau tetap sama untuk semua tujuan, `ORIGIN_SBY` di DB kemungkinan masih menunjuk kelurahan Jakarta.

### A5 — Slot pickup bisa dibuat untuk KEDUA alamat di tanggal yang sama

Ini yang paling berisiko dan paling penting diuji lebih dulu: Mengantar belum tentu mengizinkan dua slot pada tanggal+jam sama untuk akun yang sama.

**Prasyarat:** `ADDR_SBY`, `ADDR_JKT`, API key. Jalankan **sebelum pukul 15:30 WIB** (aturan "minimal 90 menit dari sekarang" vs jam pickup aplikasi `17:00`, lihat `PICKUP_TIME_HHMM` di `src/lib/pickup-schedule.ts:19`). Kalau sudah sore, pakai tanggal **besok**.

**Langkah:** dua kali `POST https://{HOST}/api/public/{KEY}/time`, body:
```json
{ "address_id": "{ADDR_JKT}", "date": "09-23-2026", "time": "17:00" }
```
lalu yang kedua dengan `"address_id": "{ADDR_SBY}"`, tanggal & jam **identik**.

**Hasil yang diharapkan:** dua respons `success: true`, masing-masing `data._id` berupa 24 hex, dan **kedua `_id` berbeda**. Objek `data.address` di tiap respons menunjuk alamat yang diminta.

**Kalau GAGAL:**
- Panggilan kedua `success:false` / HTTP 4xx dengan pesan duplikat → **satu akun mungkin hanya boleh satu slot per tanggal**. Kalau ini terjadi, **seluruh rencana perubahan tidak bisa dijalankan apa adanya** — harus ditanyakan ke Mengantar (lihat bagian "Yang tak bisa diuji sendiri" #1). Hentikan di sini.
- Ditolak dengan pesan soal waktu → jaraknya < 90 menit; ulangi untuk besok.
- Alamat Surabaya ditolak sebagai tidak dikenal → alamat belum terverifikasi di sisi Mengantar (lihat H4).

> Catatan kebersihan: dua slot yang dibuat di A5 **adalah slot nyata** di sistem Mengantar. Catat `_id`-nya. Kalau tanggalnya nanti dipakai uji F, sisipkan manual ke tabel supaya cron tidak membuat slot ketiga (lihat F1).

---

## B. Kutipan ongkir per gudang

Semua uji di tahap B dilakukan **setelah `MENGANTAR_PICKUP_ORIGIN_ID` dicabut dari environment** (atau di preview deployment tanpa env itu). Selama env itu masih terpasang, `getQuoteOriginId()` (`src/lib/warehouse.ts:141-145`) memaksa satu origin dan seluruh tahap B pasti "gagal" secara artifisial.

### B1 — Baseline: dua gudang menghasilkan dua harga untuk tujuan yang sama

**Prasyarat:**
- `MENGANTAR_PICKUP_ORIGIN_ID` **kosong/dicabut**.
- Stok `PROD_NONVAR`: **`W_SBY` = 10, `W_JKT` = 10** (keduanya layak, supaya perbandingan benar-benar terjadi). Set lewat OMS → Gudang → Kelola Stok Gudang, atau:
```sql
update public.product_stock_per_warehouse
set stok = 10
where product_id = '{PROD_NONVAR}' and variant_id is null;
```
- Alamat tujuan: `DEST_JKT`.

**Langkah:**
1. Buka storefront, masukkan `PROD_NONVAR` qty 1 ke keranjang, lanjut ke checkout.
2. Buka DevTools → Network, filter `options`.
3. Isi alamat tujuan sampai "Metode Pengiriman" memuat tarif.
4. Buka request `POST /api/mengantar/shipping/options` → tab Response.

**Hasil yang diharapkan:**
```json
{ "options": [ { "id": "JT", "price": <angka>, "warehouseId": "<uuid>", "warehouseName": "<nama>" } ],
  "warehousesConsidered": 2,
  "warehousesResponded": 2 }
```
- `warehousesConsidered` = **2** (dua gudang punya stok cukup).
- `warehousesResponded` = **2** ← ini bukti Mengantar dipanggil **per origin**, bukan sekali. Kalau nilainya 2 tapi kedua gudang berbagi origin, angka ini tetap 2 (lihat `warehouse-shipping.ts:210`) — jadi jangan berhenti di sini, lanjut B2.
- `options` panjangnya **1** (sudah lewat `cheapestPerCourier`), dan `price` = **min(`P_JKT_1kg`, `P_SBY_1kg`)** dari A4, `warehouseId` = gudang pemilik origin termurah itu.

**Verifikasi di Supabase:** tidak ada, tahap ini murni jaringan. Yang perlu dicocokkan adalah `warehouseId` di respons dengan query A0.

**Kalau GAGAL:**
- `price` tidak sama dengan salah satu angka A4 → berat kirim bukan 1kg (cek `products.berat`; kosong → cadangan 1kg/pcs), atau host cek ongkir beda dengan host yang kamu panggil manual di A4.
- `warehousesResponded` = 1 → salah satu gudang `mengantar_origin_id`-nya kosong, sehingga dibuang saat pengelompokan origin (`warehouse-shipping.ts:191-193`). Cek A0.
- `warehousesConsidered` = 1 → hanya satu gudang berstok cukup. Betulkan stok.

### B2 — Harga yang dikutip = harga origin gudang yang benar (bukan rata-rata, bukan origin lain)

**Prasyarat:** B1 selesai; `P_JKT_1kg` & `P_SBY_1kg` dari A4 sudah dicatat.

**Langkah:**
1. Matikan salah satu gudang supaya cuma satu yang jadi kandidat:
```sql
update public.warehouses set is_active = false where id = '{W_SBY}';
```
2. Muat ulang checkout, ulangi B1.
3. Hidupkan lagi, lalu matikan yang satunya (`W_JKT`), ulangi.
4. Kembalikan keduanya aktif:
```sql
update public.warehouses set is_active = true;
```

**Hasil yang diharapkan:**
- Saat hanya `W_JKT` aktif → `options[0].price` = **persis `P_JKT_1kg`**, `warehouseId` = `W_JKT`, `warehousesConsidered = 1`.
- Saat hanya `W_SBY` aktif → `price` = **persis `P_SBY_1kg`**, `warehouseId` = `W_SBY`.

Uji ini yang benar-benar membuktikan kutipan mengikuti origin gudang. B1 sendiri tidak cukup: kalau kedua gudang diam-diam berbagi satu origin, B1 tetap lolos.

**Kalau GAGAL:** harga tidak berubah saat gudang ditukar → `getQuoteOriginId` masih mengembalikan nilai yang sama untuk keduanya. Penyebab paling mungkin: (a) env `MENGANTAR_PICKUP_ORIGIN_ID` masih terpasang di Vercel (cabut lalu **redeploy** — env tidak berlaku tanpa deploy ulang), (b) `mengantar_origin_id` kedua gudang bernilai sama di DB.

### B3 — Kutipan ikut berat, dan kedua origin ikut naik konsisten

**Prasyarat:** B2 lolos.

**Langkah:** ulangi B1 dengan qty yang membuat berat menjadi ±3 kg (cek `products.berat` dalam gram; `shippingWeightKg` membulatkan ke atas). Bandingkan dengan panggilan manual `allEstimatePublic` `weight=3` untuk kedua origin.

**Hasil yang diharapkan:** `options[0].price` = min dari kedua angka 3kg. Gudang pemenang boleh saja **berpindah** dibanding B1 — itu sah dan justru menarik dicatat (tarif per zona tidak naik proporsional).

**Kalau GAGAL:** harga tidak naik dari B1 → berat produk kosong sehingga selalu jatuh ke cadangan 1kg. Isi `products.berat` dulu; ongkir yang salah berat adalah sumber selisih tagihan yang terpisah dari masalah origin.

---

## C. Pemilihan gudang kembali berbasis ongkir

### C1 — Tujuan Jakarta: gudang termurah menang, bukan gudang default

**Prasyarat:** stok `PROD_NONVAR` **`W_SBY` = 10, `W_JKT` = 10**; tujuan `DEST_JKT`; env pickup origin sudah dicabut.

**Langkah:**
1. Checkout `PROD_NONVAR` qty 1 ke `DEST_JKT` sampai tuntas (bayar simulasi belum perlu).
2. Catat nomor invoice.

**Hasil yang diharapkan:** `orders.warehouse_id` = gudang **termurah menurut B1**, dan `orders.ongkos_kirim` = harga termurah itu.

**Verifikasi di Supabase:**
```sql
select o.nomor_invoice,
       o.ongkos_kirim,
       o.jumlah_total,
       w.nama            as gudang,
       w.is_default,
       w.mengantar_origin_id,
       w.mengantar_address_id,
       o.destination_id,
       o.created_at
from public.orders o
left join public.warehouses w on w.id = o.warehouse_id
where o.nomor_invoice = '{INVOICE}';
```

**Kalau GAGAL:**
- `gudang` = "Gudang Utama Infarm" padahal B1 bilang Jakarta yang termurah **dan `is_default` = true** → pemilihan jatuh ke `resolveWarehouseForOrder` (`warehouse.ts:107` mendahulukan gudang default). Artinya `warehouseId` dari client tidak lolos `pickVerifiedWarehouse` (stok tidak cukup / gudang non-aktif), atau client memang tidak mengirim `warehouseId`. Cek stok per gudang lebih dulu.
- `ongkos_kirim` NULL → pesanan dibuat lewat jalur yang tidak mengisi kolom; periksa overload RPC mana yang dipanggil (lihat G1).

### C2 — Tujuan Surabaya: pemenangnya BERPINDAH (uji simetris)

Ini uji yang paling meyakinkan. C1 sendirian bisa lolos secara kebetulan kalau sistem masih memaku satu gudang yang kebetulan termurah.

**Prasyarat:** identik dengan C1, tujuan diganti `DEST_SBY`.

**Langkah:** ulangi C1 dengan alamat Surabaya. Catat dulu `options[0]` dari Network.

**Hasil yang diharapkan:** `options[0].warehouseId` **berbeda** dari C1, dan `orders.warehouse_id` mengikutinya. Di produksi: C1 → Gudang Jakarta, C2 → Gudang Utama Infarm.

**Verifikasi di Supabase:**
```sql
select o.nomor_invoice, o.kota, o.kecamatan, o.ongkos_kirim, w.nama as gudang
from public.orders o
left join public.warehouses w on w.id = o.warehouse_id
where o.nomor_invoice in ('{INVOICE_C1}', '{INVOICE_C2}')
order by o.created_at;
```
Dua baris, **dua nama gudang berbeda**.

**Kalau GAGAL:** kedua pesanan mendarat di gudang yang sama → pemilihan belum berbasis ongkir. Penyebab berurut: env belum dicabut → gudang lain kehabisan stok → `mengantar_origin_id` kembar → client tidak mengirim `warehouseId`.

### C3 — Gudang termurah kehabisan stok → jatuh ke termurah BERIKUTNYA, bukan ke default

**Prasyarat:** tujuan `DEST_JKT`. Kosongkan stok di gudang pemenang C1:
```sql
update public.product_stock_per_warehouse
set stok = 0
where product_id = '{PROD_NONVAR}' and variant_id is null
  and warehouse_id = '{W_PEMENANG_C1}';
-- gudang satunya tetap 10
```

**Langkah:** checkout `PROD_NONVAR` qty 1 ke `DEST_JKT`.

**Hasil yang diharapkan:**
- `options[0].warehouseId` = gudang yang **masih berstok**, `price` = harga origin gudang itu (bukan harga C1 lagi — `getEligibleWarehouses` menyaring lebih dulu, `warehouse-shipping.ts:125-129`).
- Pesanan berhasil (201), `orders.warehouse_id` = gudang berstok, `orders.ongkos_kirim` = harga baru itu.

**Verifikasi di Supabase:** query C1, plus:
```sql
select w.nama, psw.stok
from public.product_stock_per_warehouse psw
join public.warehouses w on w.id = psw.warehouse_id
where psw.product_id = '{PROD_NONVAR}' and psw.variant_id is null;
```
Gudang pemenuh berkurang 1 (10 → 9); gudang kosong tetap 0.

**Kalau GAGAL:** kalau `ongkos_kirim` masih angka C1 sementara `warehouse_id` gudang lain → **ini bug serius**: pembeli ditagih tarif gudang yang tidak mengirim. Artinya `getEligibleWarehouses` dan `pickVerifiedWarehouse` membaca sumber stok yang berbeda. Jangan lanjut ke D.

---

## D. Booking menjemput di gudang yang benar

Mulai dari sini setiap uji **menghabiskan saldo Mengantar dan menerbitkan resi sungguhan**. Batasi jumlahnya, dan siapkan cara membatalkannya (`orders.mengantar_object_id` / `mengantar_order_id` tersimpan sejak migration `20260909120000`).

### D1 — `pickup.address_id` mengikuti `orders.warehouse_id`

**Prasyarat:** C1 & C2 lolos; dua pesanan dari C1 (gudang Jakarta) dan C2 (gudang Surabaya) masih berstatus belum dibayar; lingkungan memenuhi syarat penjaga host (0.3b).

**Langkah:**
1. Panggil endpoint simulasi untuk pesanan C1:
   `POST /api/dev/simulate-payment` body `{ "invoice": "{INVOICE_C1}" }`
2. Ulangi untuk `INVOICE_C2`.
3. Baca log server (Vercel → Logs, cari `[mengantar-shipment] booking`) untuk kedua pesanan.

**Hasil yang diharapkan:**
- Respons `{ invoice, paymentStatus: "Lunas", shipment: { ok: true, trackingNumber: "JO…", ... } }`.
- Log booking C1 menyebut `time_id` **berbeda** dengan log booking C2 (karena time_id kini per alamat).
- Di dashboard Mengantar, paket C1 terjadwal dijemput di **Cengkareng**, paket C2 di **Surabaya**.

**Verifikasi di Supabase:**
```sql
select o.nomor_invoice,
       w.nama                as gudang,
       w.mengantar_address_id,
       o.no_tracking,
       o.mengantar_object_id,
       o.mengantar_order_id,
       o.shipment_status,
       p.address_id          as address_id_slot,
       p.time_id,
       p.date
from public.orders o
left join public.warehouses w            on w.id = o.warehouse_id
left join public.mengantar_daily_pickup p
       on p.address_id = w.mengantar_address_id
      and p.date = (o.created_at at time zone 'Asia/Jakarta')::date
where o.nomor_invoice in ('{INVOICE_C1}', '{INVOICE_C2}');
```
Yang dicari: untuk tiap baris, `w.mengantar_address_id` = `p.address_id`, dan dua baris punya `time_id` yang berbeda.

> Kolom `mengantar_daily_pickup.address_id` adalah bagian perubahan #3. Sebelum migration itu jalan, join di atas galat — itu sendiri sudah sinyal bahwa perubahan #3 belum terpasang.

**Kalau GAGAL:**
- Kedua booking memakai `time_id` sama → `createShipmentOrder` masih membaca `getTodayPickupTimeId()` tanpa parameter alamat (`mengantar-shipment.ts:220`). Perubahan #4 belum lengkap.
- `reason: 'not-configured'` → `mengantar_address_id` gudang NULL (lihat H3).
- `reason: 'no-pickup-time'` → belum ada slot untuk alamat itu di tanggal tersebut; cron multi-alamat (F) belum jalan.
- Booking sukses tapi dashboard Mengantar menunjukkan penjemputan di Cengkareng untuk pesanan C2 → `address_id` yang dikirim masih dari env. Ini kegagalan inti; ulangi setelah perbaikan.

### D2 — Env `MENGANTAR_STORE_ADDRESS_ID` sudah tak menentukan apa-apa

**Prasyarat:** D1 lolos.

**Langkah:** di Vercel, ubah `MENGANTAR_STORE_ADDRESS_ID` menjadi nilai `ADDR_SBY` (alamat Surabaya) — sengaja "salah" untuk pesanan Jakarta. Redeploy. Buat satu pesanan baru yang seharusnya dipenuhi Gudang Jakarta (tujuan `DEST_JKT`, stok hanya di `W_JKT`), lalu simulate-payment.

**Hasil yang diharapkan:** booking tetap dijemput di **Cengkareng**. Env itu tidak lagi berpengaruh pada `POST /order`.

**Verifikasi di Supabase:** query D1, pastikan `address_id_slot` = `ADDR_JKT`.

**Kalau GAGAL:** kalau penjemputannya berpindah ke Surabaya, env masih dibaca di jalur booking → perubahan #4 belum benar-benar menggantikan `mengantar-shipment.ts:201`.

**Setelah uji ini:** kembalikan `MENGANTAR_STORE_ADDRESS_ID` ke nilai semula (masih dibutuhkan sebagai jalur rollback H5) dan redeploy.

---

## E. Rekonsiliasi kutip vs tagih — tujuan utama seluruh perubahan

### E0 — Dua jenis selisih yang harus dibedakan lebih dulu

Sebelum menghakimi angka apa pun, pisahkan:

1. **Selisih RUTE** — dikutip dari origin A, ditagih dari origin B. Inilah insiden INV-20260820-4876 (Rp18.000 vs ~Rp25.000). Setelah perubahan ini, selisih jenis ini harus **nol**.
2. **Selisih DISKON** — kutipan memakai `GET /api/order/allEstimatePublic` yang berdiskon **flat 20% untuk semua pengguna**, sementara tagihan akun mengikuti diskon **berbasis volume** (yang juga tercermin di `GET /api/public/{KEY}/order/estimate`). Selisih ini **sah**, bersifat sistematis, dan **rasionya konstan** untuk semua rute. Ia tidak boleh dikira bug.

Cara membedakan di lapangan: kalau `tagihan / kutipan` menghasilkan **rasio yang sama** untuk pesanan Jakarta dan Surabaya, itu selisih diskon. Kalau rasionya beda jauh antar rute (atau salah satunya 1,0 dan yang lain 1,4), itu selisih rute → masih bug.

### E1 — Kutipan per gudang vs estimasi akun (tanpa menerbitkan resi)

**Prasyarat:** API key; `ORIGIN_SBY`, `ORIGIN_JKT`, `DEST_JKT`, `DEST_SBY`.

**Langkah:** untuk **empat** kombinasi (2 origin × 2 tujuan), berat 1 kg, panggil berpasangan:
```
GET https://{HOST}/api/order/allEstimatePublic?origin_id={ORIGIN}&destination_id={DEST}&weight=1
GET https://{HOST}/api/public/{KEY}/order/estimate?...   ← parameter persisnya PERLU DIKONFIRMASI
```

> ⚠️ Dokumentasi yang kita punya menyebut endpoint `/order/estimate` ada dan berdiskon-volume, tapi **daftar parameternya tidak ada di fakta terverifikasi**. Jangan menebak nama parameter. Kalau belum jelas, lewati sisi kanan tabel dan bandingkan langsung ke tagihan nyata di E2.

**Hasil yang diharapkan:** tabel 4 baris dengan kolom `origin`, `tujuan`, `harga_public`, `harga_akun`, `rasio`. Keempat `rasio` **kira-kira sama**.

**Kalau GAGAL:** satu rasio menyimpang jauh → rute itu punya perlakuan tarif berbeda; catat dan tanyakan ke Mengantar sebelum mengandalkan kutipan publik untuk rute itu.

### E2 — Rekonsiliasi pesanan nyata: yang dikutip = yang ditagih

**Prasyarat:** D1 lolos; pesanan C1 & C2 sudah punya resi.

**Langkah:**
1. Buka dashboard Mengantar → riwayat transaksi / mutasi saldo, cari dua resi dari D1.
2. Catat biaya yang benar-benar dipotong per resi.
3. Bandingkan dengan `orders.ongkos_kirim`.

**Hasil yang diharapkan:**
| Invoice | Gudang | `ongkos_kirim` (dikutip) | dipotong saldo | selisih |
|---|---|---|---|---|
| C1 | Gudang Jakarta | `P_JKT_1kg` | ≈ sama | 0, atau selisih diskon yang **rasionya sama dengan C2** |
| C2 | Gudang Utama | `P_SBY_1kg` | ≈ sama | idem |

Yang **tidak boleh** terjadi: C2 dikutip harga Surabaya tapi ditagih harga Cengkareng. Itulah kekambuhan insiden.

**Verifikasi di Supabase:**
```sql
-- daftar rekonsiliasi untuk diisi manual dari dashboard Mengantar
select o.nomor_invoice,
       w.nama as gudang,
       w.mengantar_origin_id,
       w.mengantar_address_id,
       o.ongkos_kirim as ongkir_dikutip,
       o.no_tracking,
       o.kota, o.kecamatan,
       o.created_at
from public.orders o
join public.warehouses w on w.id = o.warehouse_id
where o.no_tracking is not null
  and o.created_at >= now() - interval '7 days'
order by o.created_at desc;
```

> **Keterbatasan yang harus diterima:** tabel `orders` **tidak punya kolom `ongkir_aktual`** — hanya `ongkos_kirim` (yang dikutip). Jadi rekonsiliasi ini **tidak bisa otomatis**; harus ditempel manual dari dashboard Mengantar. Persis inilah yang membuat insiden Agustus baru ketahuan belakangan. Usulan yang sudah tercatat di ROADMAP.md dan layak dikerjakan bersamaan: tambah `orders.ongkir_aktual integer` + diisi saat sinkronisasi, supaya OMS bisa menandai pesanan yang selisih tanpa kerja manual.

**Kalau GAGAL:** selisih rute muncul lagi → periksa berurut: (a) `mengantar_address_id` gudang menunjuk alamat yang benar (A1), (b) `PICKUP_AUTOFILL` alamat = `mengantar_origin_id` gudang (A3), (c) booking memakai address gudang pemenuh (D1). **Jangan cabut env sebelum E2 hijau** — env lama itulah yang sekarang menahan insiden ini.

### E3 — Uji pengulangan insiden yang persis

**Prasyarat:** tujuan **Kemayoran** (`DEST_JKT`), stok `PROD_NONVAR` hanya di **`W_SBY`** (Gudang Utama / Surabaya), `W_JKT` = 0.

**Langkah:** checkout qty 1 → simulate-payment → cek dashboard Mengantar.

**Hasil yang diharapkan:** pesanan dipenuhi Gudang Utama, dikutip **tarif Surabaya→Kemayoran**, dan **dijemput di Surabaya** sehingga ditagih tarif yang sama. Inilah skenario yang dulu bocor: dikutip Surabaya, dijemput Cengkareng.

**Verifikasi di Supabase:** query E2 untuk invoice ini, plus join `mengantar_daily_pickup` dari D1 untuk memastikan `address_id` = `ADDR_SBY`.

**Kalau GAGAL:** kalau paketnya tetap dijemput di Cengkareng, perubahan ini belum menyelesaikan apa pun — ini adalah **uji gerbang**, bukan uji pelengkap.

---

## F. Cron pickup multi-alamat

### F1 — Cron membuat satu `time_id` per (tanggal × alamat)

**Prasyarat:** migration perubahan #3 sudah jalan (`mengantar_daily_pickup.address_id` ada, unique berpindah dari `(date)` ke `(date, address_id)`). `CRON_SECRET` di tangan. Tanggal uji: hari kerja, dijalankan pagi (sebelum 15:30 WIB).

**Langkah:**
1. Kosongkan tanggal uji dulu supaya cron benar-benar bekerja:
```sql
select * from public.mengantar_daily_pickup where date = current_date;
-- kalau ada dan slotnya bukan slot yang sedang dipakai order, hapus:
-- delete from public.mengantar_daily_pickup where date = current_date;
```
2. Panggil cron manual:
   `GET https://{DOMAIN}/api/cron/mengantar-pickup` dengan header `Authorization: Bearer {CRON_SECRET}`.

**Hasil yang diharapkan:** respons `status: "created"`. Di DB muncul **DUA** baris untuk tanggal itu.

**Verifikasi di Supabase:**
```sql
select p.date, p.address_id, p.time_id, w.nama as gudang, p.created_at
from public.mengantar_daily_pickup p
left join public.warehouses w on w.mengantar_address_id = p.address_id
where p.date = current_date
order by w.nama;
```
Harapan: 2 baris, `address_id` = `ADDR_JKT` dan `ADDR_SBY`, `time_id` **berbeda**, `gudang` keduanya terisi (tidak NULL).

**Kalau GAGAL:**
- 1 baris → cron masih satu slot per tanggal; perubahan #3 belum lengkap.
- 2 baris tapi `time_id` sama → respons Mengantar untuk alamat kedua tidak terbaca dan yang tersimpan nilai lama. Cek log `[mengantar-pickup]`.
- `gudang` NULL → `address_id` di tabel pickup tidak cocok dengan `warehouses.mengantar_address_id`; satu dari dua sumber salah ketik.

### F2 — Idempoten: cron dijalankan dua kali tidak membuat slot ketiga

**Prasyarat:** F1 baru selesai.

**Langkah:** panggil endpoint cron **lagi** dengan header sama, dalam menit yang sama.

**Hasil yang diharapkan:** respons `status: "existing"`, dan jumlah baris tetap **2** (bukan 4).

**Verifikasi di Supabase:**
```sql
select date, count(*) as jml, count(distinct address_id) as jml_alamat
from public.mengantar_daily_pickup
where date >= current_date - 7
group by date order by date desc;
```
`jml` = `jml_alamat` = 2 untuk tanggal uji. Kalau `jml` > `jml_alamat`, unique constraint `(date, address_id)` belum terpasang.

**Kalau GAGAL:** baris bertambah → slot sampah tercipta di sistem Mengantar setiap cron re-run. Ini pemborosan yang senyap; hentikan cron sampai constraint dipasang.

### F3 — Fallback saat checkout: pesanan sore hari membuat slot hanya untuk alamat yang dibutuhkan

**Prasyarat:** pastikan **tidak ada** baris untuk tanggal besok. Jalankan **setelah 15:00 WIB** (cutoff `PICKUP_CUTOFF_HOUR_WIB = 15`) supaya `resolvePickupDate` memilih hari kerja berikutnya.

**Langkah:** buat satu pesanan yang dipenuhi **satu** gudang saja (stok hanya di `W_JKT`), lalu simulate-payment.

**Hasil yang diharapkan:** booking sukses, dan di DB muncul **satu** baris untuk tanggal besok dengan `address_id = ADDR_JKT`. Alamat Surabaya **belum** punya baris — dibuat nanti saat dibutuhkan atau oleh cron besok pagi.

**Verifikasi di Supabase:**
```sql
select date, address_id, time_id, created_at
from public.mengantar_daily_pickup
where date = (current_date + 1)
order by created_at;
```

**Kalau GAGAL:**
- Dua baris muncul padahal cuma satu gudang dipakai → fallback membuat slot untuk semua alamat; boros dan menciptakan slot yang tak pernah dipakai.
- Nol baris dan booking gagal `no-pickup-time` → cek apakah jarak ke jam 17:00 besok > 90 menit (harusnya iya) dan apakah penjaga host memblokir penulisan (0.3b).

---

## G. Regresi

### G1 — Overload RPC mana yang benar-benar dipanggil

Harus dipastikan lebih dulu: ada **dua** `create_order_with_items` di database (19-parameter dari migration `20260827120000` dan 22-parameter dari `20260907130000`), dan keduanya memperlakukan stok per gudang **secara berbeda**.

**Langkah (SQL Editor):**
```sql
select p.oid::regprocedure as signature, pg_get_function_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_order_with_items';
```

**Hasil yang diharapkan:** kalau muncul **dua** baris, ketahui bahwa aplikasi (yang mengirim `diskon`, `ongkos_kirim_ditanggung`, `promo_terpakai`) memakai yang **22 parameter** — dan itulah yang mengandung bug varian di G4.

**Kalau GAGAL / ambigu:** kalau dua overload punya bentuk yang bisa tertukar, PostgREST bisa memilih yang salah diam-diam dan parameter baru diabaikan (persis peringatan yang ditulis sendiri di migration `20260827120000`). Gejalanya: `orders.diskon`/`promo_terpakai` selalu default padahal promo aktif.

### G2 — Stok berkurang di gudang yang benar + jejak mutasi

**Prasyarat:** `PROD_NONVAR`, `W_SBY` = 10, `W_JKT` = 10. Catat angka awal.

**Langkah:** checkout qty 2 ke `DEST_JKT` (biarkan sistem memilih gudang).

**Hasil yang diharapkan:** gudang pemenuh berkurang **tepat 2**, gudang lain **tidak berubah**, `products.stock` (kolom mirror lama) berkurang 2.

**Verifikasi di Supabase:**
```sql
-- stok per gudang
select w.nama, psw.stok
from public.product_stock_per_warehouse psw
join public.warehouses w on w.id = psw.warehouse_id
where psw.product_id = '{PROD_NONVAR}' and psw.variant_id is null
order by w.nama;

-- kolom mirror lama
select nama, stock from public.products where id = '{PROD_NONVAR}';

-- jejak mutasi
select warehouse_name, product_name, stok_before, stok_after, reason, order_invoice, created_at
from public.stock_mutations
where product_id = '{PROD_NONVAR}'
order by created_at desc
limit 5;
```
Baris teratas `stock_mutations`: `reason = 'order'`, `stok_before - stok_after = 2`, `warehouse_name` = nama gudang pemenuh, `order_invoice` = invoice tadi.

**Kalau GAGAL:**
- Kedua gudang berkurang → ada dua jalur pengurangan stok yang jalan bersamaan.
- `stock_mutations` kosong → pencatatan audit dilewati (`src/lib/stock-audit.ts`); stok benar tapi tak ada jejak, dan rekonsiliasi bulanan jadi mustahil.
- `warehouse_name` ≠ gudang di `orders.warehouse_id` → gudang yang dipotong stoknya beda dengan yang tercatat di pesanan. **Berhenti**; ini merusak seluruh premis multi-gudang.

### G3 — Pembatalan mengembalikan stok ke gudang ASAL (bukan ke default)

**Prasyarat:** satu pesanan dari C2 (dipenuhi **Gudang Utama**, bukan Jakarta) yang belum dibatalkan. Catat stok kedua gudang sebelum membatalkan.

**Langkah:** OMS → Pesanan → ubah status pesanan itu menjadi **Dibatalkan** (atau lewat pembatalan oleh pembeli).

**Hasil yang diharapkan:** stok kembali ke **gudang pemenuh pesanan itu**, bukan ke gudang default. Kalau pesanan dipenuhi `W_SBY` maka `W_SBY` naik, `W_JKT` tetap.

**Verifikasi di Supabase:**
```sql
select o.nomor_invoice, o.order_status, w.nama as gudang_pesanan
from public.orders o join public.warehouses w on w.id = o.warehouse_id
where o.nomor_invoice = '{INVOICE}';

select warehouse_name, stok_before, stok_after, reason, order_invoice, created_at
from public.stock_mutations
where order_invoice = '{INVOICE}'
order by created_at;
```
Harus ada **dua** baris: `reason = 'order'` (turun) lalu `reason = 'order_cancelled'` (naik), keduanya `warehouse_name` **sama**.

**Kalau GAGAL:** `order_cancelled` mendarat di gudang lain → `returnStockToWarehouse` (`warehouse.ts:273-287`) tidak menerima `orders.warehouse_id` dan jatuh ke default. Akibat nyatanya: stok menumpuk di satu gudang dan habis di gudang lain tanpa ada yang memindahkan barang fisik.

### G4 — Rebutan stok bersamaan (dua HP, dua data seluler)

**Prasyarat:** `PROD_NONVAR` dengan stok **tepat 1** di **satu** gudang, gudang satunya **0**:
```sql
update public.product_stock_per_warehouse set stok = 1
where product_id='{PROD_NONVAR}' and variant_id is null and warehouse_id='{W_JKT}';
update public.product_stock_per_warehouse set stok = 0
where product_id='{PROD_NONVAR}' and variant_id is null and warehouse_id='{W_SBY}';
```
Dua HP, **data seluler berbeda** (rate limit 3/menit/IP), keduanya sudah di halaman checkout dengan alamat terisi dan tombol bayar siap ditekan.

**Langkah:** tekan "Buat Pesanan" di kedua HP sedekat mungkin (hitungan mundur 3-2-1).

**Hasil yang diharapkan:** satu HP dapat **201** (sukses), satu lagi **409** dengan pesan `Stok produk {nama} tidak mencukupi`. Tidak boleh dua-duanya sukses.

**Verifikasi di Supabase:**
```sql
select count(*) from public.orders
where created_at >= now() - interval '5 minutes'
  and id in (select order_id from public.order_items where product_id = '{PROD_NONVAR}');
-- harus 1

select w.nama, psw.stok from public.product_stock_per_warehouse psw
join public.warehouses w on w.id = psw.warehouse_id
where psw.product_id = '{PROD_NONVAR}' and psw.variant_id is null;
-- W_JKT = 0, W_SBY = 0
```

**Kalau GAGAL:** dua pesanan masuk dan `stok` menjadi negatif atau tetap 0 dengan dua order → kunci `FOR UPDATE` tidak bekerja (RPC 22-param baris 139-142 pada jalur non-varian). Kalau salah satu justru dapat 429, itu rate limit — ulangi dengan jaringan yang benar-benar berbeda.

### G5 — UJI KHUSUS: membuktikan bug produk BERVARIAN (jangan diperbaiki dulu, dibuktikan dulu)

Ini uji yang **diharapkan GAGAL**. Tujuannya mengukur dampak bug supaya keputusan "perbaiki sekarang atau nanti" punya bukti.

**Prasyarat:** satu produk **bervarian** (`PROD_VAR`, varian `VAR_A`). Set:
```sql
update public.product_stock_per_warehouse set stok = 5
where product_id='{PROD_VAR}' and variant_id='{VAR_A}';   -- kedua gudang jadi 5

update public.product_variants set stok = 10 where id='{VAR_A}';
```
Catat semua angka.

**Langkah:** checkout `PROD_VAR`/`VAR_A` qty 2 ke `DEST_JKT` sampai pesanan terbentuk.

**Hasil yang diharapkan (= perilaku buggy yang dibuktikan):**
- `product_variants.stok` 10 → **8** (berkurang, lewat cabang `if v_variant_id is not null`).
- **KEDUA** baris `product_stock_per_warehouse` tetap **5** — tidak berkurang sama sekali.
- `orders.warehouse_id` tetap terisi (gudang tercatat), padahal stok gudang itu tak pernah disentuh.

**Verifikasi di Supabase:**
```sql
select w.nama, psw.stok as stok_per_gudang
from public.product_stock_per_warehouse psw
join public.warehouses w on w.id = psw.warehouse_id
where psw.product_id = '{PROD_VAR}' and psw.variant_id = '{VAR_A}';

select nama_varian, stok from public.product_variants where id = '{VAR_A}';

select warehouse_name, stok_before, stok_after, reason
from public.stock_mutations
where variant_id = '{VAR_A}' order by created_at desc limit 3;
```

**Uji lanjutan yang lebih tajam:** set kedua baris per-gudang varian itu ke **0**, `product_variants.stok` tetap 10, lalu pesan qty 1. **Pesanan tetap berhasil** — padahal tidak ada gudang yang punya barangnya menurut tabel per-gudang.

**Artinya kalau perilaku ini terkonfirmasi:**
1. `getEligibleWarehouses` dan `resolveShippingOptions` membaca `product_stock_per_warehouse`, yang untuk produk bervarian **tidak pernah turun**. Jadi kedua gudang akan selamanya tampak berstok → perbandingan ongkir menawarkan gudang yang sebenarnya kosong.
2. Seluruh hasil tahap B/C/D untuk produk bervarian **tidak bisa dipercaya**.
3. **Kesimpulan operasional: sampai bug ini diperbaiki, jangan pernah memakai produk bervarian untuk uji mana pun di rencana ini selain G5.** Dan sebaiknya, jangan menjual produk bervarian dalam mode multi-gudang.

**Perbaikannya (di luar lingkup rencana uji ini):** cabang varian di migration `20260907130000` harus meniru struktur cabang non-varian — cari baris `product_stock_per_warehouse` dengan `variant_id` terisi, `FOR UPDATE`, cek, kurangi, baru mirror ke `product_variants.stok`. Migration `20260827120000` (19-param) sudah melakukannya dengan benar dan bisa dipakai sebagai contoh.

---

## H. Edge case & rollback

### H1 — Satu gudang kehabisan stok total

**Prasyarat:** `PROD_NONVAR` = 0 di **kedua** gudang.

**Langkah:** coba checkout qty 1.

**Hasil yang diharapkan:** UI menolak sebelum bayar (stok habis di katalog/keranjang). Kalau lolos sampai `POST /orders/create`, responsnya **409** `Stok produk {nama} tidak mencukupi`, tidak ada baris `orders` yang tertinggal.

**Verifikasi di Supabase:**
```sql
select count(*) from public.orders where created_at >= now() - interval '5 minutes';
-- 0, atau tak bertambah
```
Cek juga `resolveShippingOptions`: karena tak ada gudang layak, ia jatuh ke gudang default (`warehouse-shipping.ts:181-184`) — jadi pembeli **tetap melihat tarif**, dan penolakannya terjadi di RPC. Itu perilaku yang disengaja; pastikan pesan errornya terbaca pembeli.

**Kalau GAGAL:** pesanan terbentuk dengan stok negatif → constraint `product_stock_per_warehouse_stok_check (stok >= 0)` seharusnya menahannya; kalau tidak kena, berarti pengurangan terjadi di kolom lama saja (jalur fallback RPC).

### H2 — Gudang tujuan tak dilayani J&T

**Prasyarat:** alamat tujuan di daerah yang tidak dilayani J&T (**perlu ditemukan sendiri lewat coba-coba**; `docs` tidak mencatat daftar rute tutup).

**Langkah:** isi alamat tujuan itu di checkout, amati Network → `options`.

**Hasil yang diharapkan:** `{ "options": [], "reason": "NO_JT_SERVICE" }` (bukan `ESTIMATE_UNAVAILABLE`). UI menyarankan ganti alamat, bukan "coba lagi".

**Kalau GAGAL:**
- `reason: "ESTIMATE_UNAVAILABLE"` padahal Mengantar menjawab → `warehousesResponded` salah hitung; sesudah perubahan ini setiap origin dipanggil sendiri, jadi angka itu bisa berubah maknanya. Perhatikan `warehouse-shipping.ts:205-214`.
- `options` terisi dengan `price: 0` → filter `isSelectableCourier` bocor; pembeli ditawari "gratis ongkir" palsu.
- Menarik dicatat: kalau **satu** origin tak melayani tujuan tapi origin lain melayani, hasilnya harus tetap ada opsi (dari gudang yang melayani). Uji ini layak dicari sengaja — ia adalah keuntungan nyata dari punya dua alamat.

### H3 — Gudang tanpa `mengantar_address_id`

**Prasyarat:** kosongkan sementara:
```sql
update public.warehouses set mengantar_address_id = null where id = '{W_SBY}';
```
Stok diatur supaya `W_SBY` yang menang.

**Langkah:** checkout → simulate-payment.

**Hasil yang diharapkan (keputusan desain yang harus ditentukan sekarang, sebelum kode ditulis):** dua pilihan sah, pilih satu dan uji sesuai pilihan:
- **(a) Gudang tanpa alamat tidak boleh ikut perbandingan ongkir** — `resolveShippingOptions` membuangnya seperti membuang gudang tanpa `mengantar_origin_id` (`warehouse-shipping.ts:191-193`). Pesanan diarahkan ke gudang lain. **Ini yang direkomendasikan**: gagalnya terjadi sebelum pembeli membayar.
- **(b) Dibiarkan ikut, gagal saat booking** — `createShipmentOrder` mengembalikan `not-configured`. Pembeli sudah membayar tapi tak ada resi. Lebih buruk.

**Verifikasi di Supabase:**
```sql
select o.nomor_invoice, w.nama, w.mengantar_address_id, o.no_tracking, o.shipment_status
from public.orders o join public.warehouses w on w.id = o.warehouse_id
where o.nomor_invoice = '{INVOICE}';
```
Pada opsi (a): `nama` bukan Gudang Utama. Pada opsi (b): `no_tracking` NULL dan `shipment_status` menandai kegagalan.

**Kembalikan setelah uji:**
```sql
update public.warehouses set mengantar_address_id = '{ADDR_SBY}' where id = '{W_SBY}';
```

**Kalau GAGAL:** pesanan berhasil dibooking padahal `mengantar_address_id` NULL → kode diam-diam jatuh kembali ke `MENGANTAR_STORE_ADDRESS_ID`. Itu berarti ketidakselarasan lama kembali secara senyap, justru pada kasus yang paling tidak diawasi.

### H4 — Alamat pickup baru ditolak / belum terverifikasi

**Prasyarat:** — (uji observasional, bergantung status akun).

**Langkah:**
1. Coba `POST /api/public/{KEY}/time` dengan `address_id = ADDR_SBY` (sudah dilakukan di A5).
2. Kalau ditolak, catat pesan persisnya.

**Hasil yang diharapkan:** kalau alamat sudah terverifikasi → sukses (A5). Kalau belum → pesan penolakan yang jelas.

**Kalau GAGAL / ditolak:**
- Jangan lanjut ke tahap F/D untuk alamat itu.
- Jaring pengaman yang harus ada di kode: bila `createPickupTime` gagal untuk satu alamat, **pesanan untuk gudang lain tidak boleh ikut gagal**. Uji: bikin `address_id` gudang Surabaya sengaja salah (string acak 24 hex), jalankan cron F1, dan pastikan **slot Cengkareng tetap terbuat** dan responsnya melaporkan kegagalan parsial — bukan 500 yang membatalkan semuanya.
```sql
select date, address_id, time_id from public.mengantar_daily_pickup where date = current_date;
-- tetap harus ada baris untuk ADDR_JKT
```

### H5 — Rollback ke env lama

**Kapan dipakai:** E2 menunjukkan selisih rute muncul lagi di produksi, atau F1 membuat slot sampah, atau Mengantar menolak alamat kedua setelah sempat menerimanya.

**Langkah rollback (urut, semuanya di Vercel + SQL Editor, tanpa revert kode bila saran di bawah diikuti):**
1. Set kembali di Vercel:
   - `MENGANTAR_PICKUP_ORIGIN_ID=5fc62f5ff8f44b34aa4c0dbc`
   - `MENGANTAR_STORE_ADDRESS_ID={ADDR_JKT}` (nilai semula)
2. **Redeploy** — env tidak berlaku tanpa deploy ulang.
3. Netralkan alamat gudang Surabaya supaya tak ada booking yang menjemput ke sana:
```sql
update public.warehouses set mengantar_address_id = '{ADDR_JKT}' where is_active;
```
   *(menyamakan, bukan mengosongkan — mengosongkan bisa memicu jalur `not-configured` di H3b.)*
4. Slot pickup yang sudah terlanjur dibuat untuk `ADDR_SBY` dibiarkan; ia tak akan terpakai.

**Syarat agar rollback semudah ini — tulis sebagai persyaratan implementasi, bukan uji:**
- **Jangan hapus pembacaan `MENGANTAR_PICKUP_ORIGIN_ID` di `getQuoteOriginId` pada rilis yang sama** dengan perubahan #1–#4. Biarkan ia tetap di sana (kosong di produksi) selama minimal satu siklus rilis. Perubahan #5 ("cabut env") artinya **mengosongkan nilainya**, bukan menghapus kodenya. Dengan begitu rollback = set env + redeploy, tanpa `git revert`.
- Hal yang sama berlaku untuk `MENGANTAR_STORE_ADDRESS_ID` di `mengantar-shipment.ts`: jadikan **fallback** bila `warehouse.mengantar_address_id` kosong — kecuali kalau opsi (a) di H3 dipilih, yang memang lebih ketat. Kalau memilih (a), rollback tetap butuh langkah 3 di atas.

**Yang TIDAK bisa di-rollback dengan mudah:** perubahan unique constraint `mengantar_daily_pickup` dari `(date)` ke `(date, address_id)`. Begitu ada dua baris untuk satu tanggal, mengembalikan unique `(date)` akan **galat**. Kalau harus mundur, hapus dulu baris untuk alamat yang tak dipakai:
```sql
delete from public.mengantar_daily_pickup
where address_id is distinct from '{ADDR_JKT}';
```
Lakukan hanya untuk tanggal yang **belum punya pesanan berjalan** — menghapus baris yang time_id-nya sudah dipakai booking akan memutus jejak jadwal penjemputan.

---

## Urutan pengerjaan yang disarankan

**Fase 1 — tanpa menyentuh kode, tanpa menulis apa pun (bisa dikerjakan hari ini):**
`A1 → A2 → A4 → A5`

A5 adalah **gerbang paling awal**. Kalau Mengantar tak mengizinkan dua slot pickup pada tanggal yang sama untuk satu akun, seluruh rancangan ini harus diubah sebelum satu baris kode ditulis. Kerjakan ini lebih dulu.

**Fase 2 — setelah migration #1 & #3 + kode #2/#4 masuk ke preview:**
`G1 → A3 → B2 → B1 → B3 → F1 → F2 → F3`

**Fase 3 — di lingkungan yang boleh menulis ke Mengantar:**
`C1 → C2 → C3 → D1 → D2 → E1 → E2 → E3`

**Fase 4 — regresi & batas:**
`G2 → G3 → G4 → G5 → H1 → H2 → H3 → H4`

**Fase 5:** baru kosongkan `MENGANTAR_PICKUP_ORIGIN_ID` di produksi, redeploy, lalu **ulangi E2 dan E3 di produksi** dengan pesanan nyata bernilai kecil.

---

## WAJIB lolos sebelum mengosongkan `MENGANTAR_PICKUP_ORIGIN_ID`

Env ini adalah satu-satunya hal yang sekarang menahan insiden INV-20260820-4876 terulang. Mengosongkannya tanpa gerbang di bawah = membuka kembali kebocoran saldo yang tak tercatat di tabel mana pun.

| # | Uji | Kenapa jadi gerbang |
|---|---|---|
| 1 | **A5** | Tanpa dua slot pickup di tanggal sama, booking gudang kedua tak mungkin terjadi |
| 2 | **A3** | Kalau `PICKUP_AUTOFILL` ≠ `mengantar_origin_id`, kutipan dan tagihan tetap beda rute — persis masalah lama, dengan wajah baru |
| 3 | **B2** | Bukti kutipan benar-benar mengikuti origin per gudang |
| 4 | **D1** | Bukti penjemputan mengikuti gudang pemenuh |
| 5 | **E3** | Reproduksi persis skenario insiden, harus bersih |
| 6 | **E2** | Selisih kutip-vs-tagih nyata sudah diukur dan dijelaskan (rute = 0; sisanya diskon) |
| 7 | **F1 + F2** | Slot per alamat terbuat dan tidak menciptakan sampah saat cron re-run |
| 8 | **H3** | Perilaku gudang tanpa alamat sudah ditentukan dan terbukti, bukan kejutan di produksi |

**Bukan gerbang, tapi wajib diketahui sebelum melangkah:** **G5**. Bug produk bervarian tidak menghalangi pencabutan env, tapi ia membuat seluruh jaminan stok-per-gudang **tidak berlaku untuk produk bervarian**. Kalau saat ini ada produk bervarian yang dijual aktif, perbaiki dulu atau nonaktifkan penjualannya — bukan karena pickup, tapi karena stoknya akan terjual melebihi yang ada.

**Catatan urutan pencabutan:** cabut `MENGANTAR_PICKUP_ORIGIN_ID` **lebih dulu**, biarkan `MENGANTAR_STORE_ADDRESS_ID` tetap terpasang sebagai jaring pengaman selama ±1 minggu, baru rapikan. Mencabut keduanya sekaligus menghapus dua jalur mundur dalam satu deploy.

---

## Yang TIDAK bisa diuji sendiri — harus dikonfirmasi ke Mengantar

1. **Apakah satu akun boleh punya dua slot pickup (`POST /time`) untuk tanggal & jam yang SAMA di alamat berbeda?** — Ini asumsi terbesar dari seluruh rancangan. A5 mengujinya secara empiris, tapi hasil "berhasil sekali" tidak menjamin tidak ada batas kuota harian atau penolakan belakangan. Tanyakan eksplisit.
2. **Apakah alamat pickup yang baru didaftarkan butuh verifikasi manual, berapa lama, dan bagaimana mengetahui statusnya?** — Dokumentasi publik hanya menyebut field `POST /address`, tidak menyebut status verifikasi. `GET /address` mengembalikan array tapi **tidak diketahui apakah ia memuat field status**.
3. **Parameter persis `GET /api/public/{KEY}/order/estimate`.** — Diketahui ada dan berdiskon-volume, tapi daftar parameternya tidak ada di fakta terverifikasi. Tanpa ini, E1 tidak bisa membandingkan kutipan publik dengan tarif akun secara langsung; rekonsiliasi terpaksa menunggu tagihan nyata (E2).
4. **Bagaimana tagihan sebenarnya dihitung — dari `pickup.address_id`, atau dari `PICKUP_ORIGIN_CODE`-nya?** — Praktisnya sama selama dua alamat punya origin code berbeda, tapi bedanya penting kalau suatu saat ada dua alamat di kota yang sama. Konfirmasi ini menentukan apakah "satu alamat per gudang" cukup atau perlu "satu zona origin per gudang".
5. **Apakah `PICKUP_AUTOFILL` ikut dikembalikan `GET /address`?** — Kalau tidak, A3 tidak bisa diverifikasi langsung dan harus bersandar pada `PICKUP_ORIGIN_CODE` (perbandingan zona, bukan kelurahan).
6. **Apakah ada cara menarik biaya aktual per resi lewat API** (bukan hanya lihat dashboard)? — Kalau ada, `orders.ongkir_aktual` bisa diisi otomatis dan E2 berhenti jadi pekerjaan manual. Kalau tidak ada, rekonsiliasi akan selamanya bergantung pada kedisiplinan membuka dashboard — dan itulah kondisi yang membuat insiden Agustus lolos berhari-hari.
7. **Apakah slot `time_id` yang dibuat tapi tak pernah dipakai punya konsekuensi** (biaya, kurir tetap datang, penalti)? — Relevan untuk F3 dan untuk slot sisa uji A5.

---

## Ringkasan temuan kode yang memengaruhi rencana ini

- `src/app/api/mengantar/shipping/options/route.ts:86` — respons ke browser lewat `cheapestPerCourier()`, jadi pembeli hanya melihat SATU baris J&T. Verifikasi gudang **harus** lewat DevTools Network, tidak bisa dari UI.
- `src/lib/warehouse-shipping.ts:186-201` — gudang dikelompokkan **per origin**, satu panggilan Mengantar per origin. Dua gudang ber-origin sama = satu panggilan dan satu harga, sehingga B1 saja tidak cukup membuktikan apa pun; B2 (matikan salah satu gudang) yang membuktikannya.
- `src/lib/warehouse-shipping.ts:181-184` — bila tak ada gudang berstok, jatuh ke gudang default supaya pembeli tetap melihat tarif. Penolakan stok terjadi di RPC, bukan di cek ongkir (relevan untuk H1).
- `src/app/api/orders/create/route.ts:714-733` — rantai tiga lapis: `pickVerifiedWarehouse(client)` → opsi termurah berikutnya dari `quoted` → `resolveWarehouseForOrder`. Lapis ketiga mendahulukan gudang **default**, jadi kalau C1 selalu memenangkan Gudang Utama, kemungkinan besar rantainya jatuh ke lapis 3.
- `supabase/migrations/20260907130000` baris ~125-133 — cabang varian tidak menyentuh `product_stock_per_warehouse` **dan tidak memeriksanya**, sehingga produk bervarian bisa terjual dari gudang yang stok per-gudangnya nol. Cabang non-varian (baris ~139-142) benar dan terkunci `FOR UPDATE`. Dua overload RPC hidup berdampingan (19-param di `20260827120000`, 22-param di `20260907130000`) — G1 memastikan mana yang dipakai.
- `orders` **tidak punya** kolom `ongkir_aktual`; hanya `ongkos_kirim` (yang dikutip, migration `20260827120000`). Rekonsiliasi E2 karenanya manual.
- `mengantar_daily_pickup` punya `date date not null unique` — perubahan #3 harus **memindahkan** unique ke `(date, address_id)`, dan itu adalah langkah yang tidak mudah dibatalkan (lihat H5).
- `mengantarWriteHost()` memblokir penulisan ke host produksi dari deployment non-produksi; `PICKUP_TIME_HHMM = '17:00'` dan `PICKUP_CUTOFF_HOUR_WIB = 15` menentukan kapan uji A5/F3 boleh dijalankan.
