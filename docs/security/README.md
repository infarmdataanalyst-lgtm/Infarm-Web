# Register Keamanan — infarm.id (Ecommerce + OMS)

**Sumber kebenaran status temuan keamanan.** File ini = register HIDUP: setiap audit hanya
meng-*update* kolom **Status** & **Terakhir diverifikasi**. Jangan pernah mendaur ulang ID —
temuan baru memakai nomor lanjutan. Detail lengkap tiap audit ada di snapshot bertanggal
(`audit-YYYY-MM-DD.md`) yang bersifat arsip (tidak diubah setelah dibuat).

> ### 📌 Aturan update (SATU tempat saja)
> Saat sebuah temuan diperbaiki, **edit file INI saja** — dua bagian:
> 1. **Tabel Status** → ubah kolom Status (mis. → ✅ Selesai) + tanggal "Terakhir diverifikasi".
> 2. **Log progres** → tambah 1 baris bertanggal (apa yang diperbaiki + bukti verifikasi).
>
> **Jangan** mengubah file `audit-YYYY-MM-DD.md` — itu arsip beku (foto temuan saat audit).
> Riwayat perbaikan = **Log progres** di bawah; history mutlak = `git log docs/security/`.

- **Cakupan:** OWASP Top 10 + kerentanan umum web app.
- **ID stabil:** prefix = severity saat ditemukan (K=Kritis, T=Tinggi, S=Sedang, R=Rendah).
- **Kadens audit:** tiap rilis besar / bulanan, **dan wajib** setelah menambah endpoint API baru.

## Riwayat audit
- **2026-07-08** — audit awal (read-only). Snapshot: [audit-2026-07-08.md](audit-2026-07-08.md).
- **2026-07-10** — audit ulang (5 area paralel) + `npm audit` (online). Snapshot: [audit-2026-07-10.md](audit-2026-07-10.md).
- **2026-07-24** — audit fitur guest by-phone. Snapshot: [audit-2026-07-24.md](audit-2026-07-24.md).
  ⚠️ Snapshot ini memakai penomoran sendiri (`K1`, `T1`, `R2`, `R3` — **tanpa tanda hubung**) yang
  TIDAK sama dengan ID register di bawah (`K-1`, `T-1`, …). Jangan tertukar saat merujuk temuan.

## Log progres
- **2026-07-08** — K-4 diperbaiki (login DB-backed + sesi HMAC httpOnly di `proxy.ts`); T-2 & S-4 sebagian.
- **2026-07-10** — audit ulang: tidak ada temuan baru yang *diselesaikan* sejak 07-08.
  Cakupan **K-1 bertambah** (endpoint `combos/*` & `promotions/*` baru ikut tak terproteksi).
  **R-2 tuntas dijalankan** (3 moderate). Temuan baru: **T-3, S-5, S-6, S-7, R-5**.
- **2026-07-10** — **K-1 & K-2 diperbaiki**: helper `requireAdmin()` (`src/lib/oms-guard.ts`,
  verifikasi cookie sesi HMAC) dipasang di 14 endpoint OMS — semua route mutasi
  `products/combos/promotions/reviews` + `GET /api/orders/list` kini balas `401` tanpa sesi admin.
  Verifikasi: `tsc`+`eslint` lolos; grep konfirmasi 14 endpoint memakai guard. **Sekaligus menutup
  S-4 (bagian `reviews/reply` admin-only) & menurunkan R-3 (endpoint tak lagi anonim).**
  Menyusul: guard endpoint baca OMS-only lain (`combos/list`, `promotions/list`, `products/check-sku`).
- **2026-07-13** — **K-3 diperbaiki**: `orders/create` kini ambil harga tiap produk dari DB
  (`promo_price`) & hitung `subtotal`/`totalAmount` di server; harga & total dari client **diabaikan**.
  Produk tak dikenal/diarsipkan → `422`. Ongkir & diskon di-clamp (`shippingCost` ≥ 0, `discount`
  0..subtotal). Verifikasi runtime: kirim `price:1, totalAmount:1` → order tersimpan total **83.400**
  & item price **75.000** (dari DB). **Sisa (roadmap):** verifikasi ongkir server-side via Mengantar
  (kini ongkir masih dipercaya dari client) → lihat S-3 saat wiring promo.
- **2026-08-06** — **rate limiting diperluas ke seluruh endpoint publik rawan bot.** Ambang batas
  dipusatkan di `src/lib/rate-limit.ts` (`RATE_LIMITS`) + helper `enforceRateLimit()` → `429` +
  pesan generik + `Retry-After`. Cakupan baru: proxy Mengantar (search alamat & **cek ongkir**),
  `orders/create` (3/mnt/IP), `reviews/create` + `reviews/create-by-phone` (3/10mnt/IP, bucket sama).
  Endpoint by-phone dapat lapis ketiga: **5/15mnt per (IP+nomor), hanya menghitung percobaan GAGAL**
  → brute-force tetap mentok 5 tebakan tanpa memblokir user asli yang mengulang pencarian nomornya
  sendiri. Dampak ke register:
  - **R-4 → ✅ Selesai.** Dua rekomendasinya dipenuhi: rate limit per-IP (20/mnt) + batas panjang
    keyword (100 karakter). Cek ongkir yang dulu di-fetch **langsung browser→Mengantar** (mustahil
    dibatasi) kini diproksi lewat `api/mengantar/shipping/estimate` — sekalian `origin_id` tak lagi
    ikut ter-bundle ke klien.
  - **R-1 → 🟡 Sebagian.** `console.warn` saat limit terpicu (masuk Vercel Logs) = sinyal dini
    brute-force; menutup **R3** pada snapshot 07-24. Audit log mutasi admin masih belum ada.
  - **K1 (snapshot 07-24) diperkuat** — sudah ✅ sejak 07-24, kini + lapis IP×nomor & logging.
  - **Tidak berubah:** **T-2** (rate limit login masih in-memory & percaya `X-Forwarded-For` mentah),
    **S-2/T1** (`orders/get` tetap tanpa rate limit/mask nama), **R2 snapshot 07-24** (counter masih
    in-memory per-instance — belum Supabase/Redis; keputusan biaya menunggu owner).
  - Verifikasi: `npx tsc --noEmit` + `npx eslint` bersih; **uji runtime dijalankan** — `orders/create`
    `422 422 422 429 429`; `track-by-phone` nomor asing 5×`200` lalu `429`; `reviews/create` ×3 lalu
    `create-by-phone` → `429` (bucket bersama terbukti); `shipping/estimate` 20×`400` lalu `429` dan
    e2e param asli mengembalikan ongkir JNE 10.900; 7 baris `[rate-limit] terpicu` di log server.
    Prosedur lengkap: [docs/testing/rate-limit-2026-08-06.md](../testing/rate-limit-2026-08-06.md).
- **2026-08-27** — **R-6 diperbaiki sebagian** (= `R7` di snapshot 07-24): ongkir tak lagi diterima
  apa adanya dari client. `orders/create` kini menyusun sendiri daftar tarif sah untuk (tujuan +
  berat server + isi keranjang) yang sama — dari cache perbandingan 10 menit, atau **dihitung ulang
  ke Mengantar bila cache miss** (cek ongkir = panggilan BACA, gratis, tanpa efek samping). Nilai
  client wajib sama persis dengan salah satu tarif itu; bila tidak → **`409 SHIPPING_MISMATCH`**
  ("Ongkos kirim sudah berubah, silakan pilih ulang kurir").
  - **Ditolak, bukan ditimpa diam-diam.** Menimpa dengan tarif server berarti pembeli ditagih angka
    berbeda dari yang ia lihat di layar — dan bila tarif baru lebih mahal, ia membayar lebih tanpa
    pernah menyetujuinya.
  - **Sisa (kenapa 🟡 bukan ✅):** bila Mengantar tak bisa dihubungi **dan** cache kosong, tak ada
    dasar pembanding sama sekali → nilai client tetap diterima dan hanya dicatat keras ke log
    (`ONGKIR TAK TERVERIFIKASI`). Disengaja: menolak di situ mematikan seluruh checkout setiap kali
    Mengantar bermasalah — kerugian yang lebih besar dan lebih sering daripada celah yang ditutup.
    Untuk memakai lubang ini, penyerang harus menunggu Mengantar down.
  - Kenapa penting: sebelumnya `POST` dengan `shippingCost: 0` membuat `orders.jumlah_total` ikut
    nol-ongkir, dan karena tagihan Xendit dibaca dari kolom itu, pembeli benar-benar membayar tanpa
    ongkir sementara tarif J&T tetap ditagih ke toko (± Rp4.000–30.000/pesanan, tanpa jejak).
  - Sekaligus dibereskan: `requirements` & `serverWeight` tadinya dihitung **dua kali** di berkas
    yang sama. Kini sekali, dipakai bersama verifikasi ongkir dan fallback gudang — duplikat itu
    bahaya laten, beda tipis antar keduanya membuat kunci cache tak cocok dan fallback gudang selalu
    meleset tanpa gejala.
  - Verifikasi: `npx tsc --noEmit` + `npx eslint` bersih; audit statis endpoint hijau seluruhnya
    (14 pemeriksaan: rate limit, validasi payload, harga DB, subtotal server, min belanja, promo
    server, stok, berat server, gudang, runtime nodejs, pencocokan ongkir, hitung-ulang saat miss).
    Uji runtime untuk jalur ongkir belum ada — membuktikannya berarti membuat pesanan sungguhan
    (CLAUDE.md → Panggilan API Berbayar); menunggu keputusan pemilik proyek.
- **2026-08-27** — **R-6 diperluas: `destination_id` ngawur kini DITOLAK.** Ditemukan saat
  memverifikasi perbaikan ongkir di atas. `destination_id` hanya divalidasi "string tak kosong",
  lalu diteruskan apa adanya ke RPC `create_order_with_items`. Verifikasi ongkir yang baru pun tak
  menolong: Mengantar tak menawarkan kurir untuk tujuan karangan → daftar tarif kosong → kode jatuh
  ke cabang "tak bisa verifikasi, terima nilai client" → **pesanan tetap tercipta**, berstatus
  `PENDING`, ke alamat yang tak akan pernah bisa dikirim. Baru ketahuan saat admin gagal membooking
  kurir.
  - **Akar masalahnya:** satu cabang menampung dua sebab yang sangat berbeda. Kini dibelah dengan
    `warehousesResponded` dari `resolveShippingOptions()`:
    | Sebab | Sinyal | Perlakuan |
    |---|---|---|
    | Mengantar tak menjawab (gangguan) | `warehousesResponded === 0` | Terima + log keras — jangan matikan checkout |
    | Mengantar menjawab, nol kurir | `responded > 0` & `options` kosong | **Tolak** `422 DESTINATION_UNSERVICEABLE` |
  - Dasar empiris: Mengantar membalas tujuan karangan dengan **HTTP 200 `{"success":true,"data":{}}`**
    — bukan error. Itulah yang membuat `responded > 0`, sehingga kedua sebab benar-benar terpisah.
    Diprobe langsung; cek ongkir adalah panggilan BACA (gratis, tanpa efek samping).
  - **Uji runtime ADA dan LOLOS** — [tests/e2e/checkout-invalid-destination.spec.ts](../../tests/e2e/checkout-invalid-destination.spec.ts),
    memakai Playwright request API (tanpa browser). Payload sah di semua field kecuali
    `destination_id`. Hasil: `422` + `code: DESTINATION_UNSERVICEABLE` + pesan untuk pembeli, dan
    **nol baris** di tabel `orders`. Uji ini aman diulang justru karena jalur benarnya tak menulis
    apa pun; bila penolakan gagal, ia melaporkan isi baris yang tertinggal (`order_status`,
    `status_pembayaran`) alih-alih sekadar merah.
  - Catatan untuk pemeriksaan manual: tabel `orders` menyimpan nilai **mentah**
    (`PENDING`/`PROCESSING`/`PAID`), bukan label OMS (`Menunggu Pembayaran`/`Diproses`/`Lunas`) —
    penerjemahan terjadi di `rowToOrder()`. Assertion yang memakai label Indonesia akan selalu
    merah pada baris yang sebenarnya sehat.

---

## Status temuan

Legenda status: 🔴 Terbuka · 🟡 Sebagian · ✅ Selesai · ⚪ Diterima/roadmap

| ID | Judul | Severity | Status | Ditemukan | Terakhir diverifikasi | Lokasi utama |
|----|-------|----------|--------|-----------|-----------------------|--------------|
| **K-1** | Endpoint API OMS tanpa auth (14 endpoint) | Kritis | ✅ Selesai (07-10) | 2026-07-08 | 2026-07-10 | `src/lib/oms-guard.ts`, 14 route `src/app/api/**` |
| **K-2** | `GET /api/orders/list` bocor PII semua pelanggan | Kritis | ✅ Selesai (07-10) | 2026-07-08 | 2026-07-10 | `src/app/api/orders/list/route.ts` (requireAdmin) |
| **K-3** | Harga & total dipercaya dari client | Kritis | ✅ Selesai (07-13) | 2026-07-08 | 2026-07-13 | `src/app/api/orders/create/route.ts` (harga dari DB) |
| **K-4** | Sesi OMS gampang dipalsukan | Kritis | ✅ Selesai (07-08) | 2026-07-08 | 2026-07-10 | `src/lib/oms-auth.ts`, `src/proxy.ts` |
| **T-1** | Secret HMAC punya fallback hardcoded + token cancel tanpa expiry | Tinggi | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/lib/order-token.ts:13`, `src/lib/oms-auth.ts:21` |
| **T-2** | Rate limit login lemah (in-memory + percaya `X-Forwarded-For`) | Tinggi | 🟡 Sebagian | 2026-07-08 | 2026-07-10 | `src/app/api/oms/login/route.ts` |
| **T-3** | Kredensial seed admin lemah & publik (`admin123`) | Tinggi | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `supabase/migrations/20260708120000_init_admin_users.sql:27` |
| **S-1** | HTTP security headers kosong | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `next.config.ts` |
| **S-2** | IDOR `GET /api/orders/get` + invoice tertebak | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/app/api/orders/get/route.ts` |
| **S-3** | Diskon/promo dihitung client, tak divalidasi server | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/lib/promo-cart.ts` |
| **S-4** | `reviews/reply` tak terproteksi + panjang/`imageUrls`/review tersembunyi | Sedang | 🟡 Sebagian | 2026-07-08 | 2026-07-10 | `src/app/api/reviews/{reply,create,list}/route.ts` |
| **S-5** | `order_items` tanpa migration → RLS tak terverifikasi (schema drift) | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `supabase/migrations/` |
| **S-6** | `products/update` validasi longgar + isi gambar tak divalidasi | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/api/products/update/route.ts` |
| **S-7** | Komponen client mengimpor modul secret `oms-auth.ts` | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/oms/login/page.tsx:13` |
| **R-1** | Logging/monitoring minim (tak ada audit log aksi admin) | Rendah | 🟡 Sebagian (08-06) | 2026-07-08 | 2026-08-06 | `src/lib/rate-limit.ts` (log 429); audit log admin belum ada |
| **R-2** | Scan CVE dependency (`npm audit`) | Rendah | ✅ Dijalankan (3 moderate) | 2026-07-08 | 2026-07-10 | `next`→`postcss` |
| **R-3** | Tak ada proteksi CSRF di API routes | Rendah | 🔴 Terbuka (naik setelah K-1) | 2026-07-08 | 2026-07-10 | `src/app/api/**` |
| **R-4** | Proxy alamat Mengantar tanpa rate limit | Rendah | ✅ Selesai (08-06) | 2026-07-08 | 2026-08-06 | `src/app/api/mengantar/{address/search,shipping/estimate}/route.ts` |
| **R-5** | `/dev/email-preview` aktif di prod + template email `{{ }}` tak di-escape | Rendah | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/dev/email-preview/route.ts`, `src/emails/order-confirmation.html` |
| **R-6** | Data pengiriman dipercaya dari client: `shippingCost` (hanya di-clamp ≥ 0) & `destination_id` (hanya dicek tak kosong) | Rendah | 🟡 Sebagian (08-27) | 2026-07-24 | 2026-08-27 | `src/app/api/orders/create/route.ts` (cocokkan ke tarif Mengantar + tolak tujuan tak terlayani) |

> Catatan penomoran: pada 07-08, `admin123` masih tercatat sebagai "Sisa" di K-4. Sejak 07-10
> dipromosikan jadi item mandiri **T-3**. Fallback `OMS_SESSION_SECRET` (dulu "Sisa" K-4)
> digabung ke **T-1** bersama `ORDER_CANCEL_SECRET`.
>
> **R-6** = temuan **R7** pada snapshot [audit-2026-07-24.md](audit-2026-07-24.md) (penomoran
> snapshot itu memang berbeda dari register — lihat peringatan di Riwayat audit). Diberi ID
> register baru, bukan menumpang K-3: K-3 sudah ✅ sejak 07-13 untuk *harga & total*, sementara
> ongkir tercatat di sana hanya sebagai "Sisa (roadmap)" — dan sisa yang tak punya ID sendiri
> tak pernah muncul di tabel status, jadi tak pernah tertagih.
>
> Cakupan **R-6 diperluas pada 08-27** ke `destination_id`, tidak dipecah jadi ID baru. Keduanya
> satu akar yang sama — *`orders/create` mempercayai data pengiriman dari client* — berada di
> beberapa baris kode yang sama, dan ditutup oleh satu perubahan. Snapshot 07-24 hanya menyebut
> `shippingCost` karena celah `destination_id` baru terlihat saat memverifikasi perbaikannya.

---

## Urutan prioritas perbaikan (usulan)
1. ~~**K-1 + K-2** — proteksi auth semua endpoint mutasi OMS + `orders/list`.~~ ✅ **Selesai 2026-07-10.**
2. ~~**K-3** — hitung ulang harga/total server-side dari DB.~~ ✅ **Selesai 2026-07-13.**
3. **T-1 + T-3** — fail-fast bila secret prod kosong; rotasi secret; ganti kredensial seed. ← **berikutnya**
4. **S-1, S-2** — security headers; token + invoice tak-tertebak untuk `orders/get`.
   (S-2 = `T1` di snapshot 07-24; rate limit + mask nama adalah mitigasi termurahnya.)
5. **T-2, S-3–S-7, R-*** — hardening. ~~R-4~~ ✅ selesai 2026-08-06.

## ✅ Yang sudah benar (jangan diubah tanpa alasan)
Query terparametrisasi (tanpa SQL injection) · stok atomik anti-race (`SELECT … FOR UPDATE`) ·
nol `dangerouslySetInnerHTML` (tanpa XSS) · `service_role` server-only (tak bocor ke bundle client) ·
RLS aktif di tabel yang ada migration-nya · cancel token HMAC timing-safe + validasi status server-side ·
`NEXT_PUBLIC_*` semuanya layak publik · `.env*` sudah di-`.gitignore`.
