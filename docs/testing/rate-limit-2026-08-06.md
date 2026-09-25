# Uji Rate Limiting — 2026-08-06

Verifikasi bahwa pembatasan di `src/lib/rate-limit.ts` benar-benar jalan di semua endpoint publik
yang rawan bot. Jalankan **sebelum deploy** dan setelah mengubah nilai di `RATE_LIMITS`.

> **Penting soal lingkungan:** `npm run dev` = satu instance, jadi hasil lokal **lebih ketat**
> daripada production Vercel (di sana request bisa tersebar ke beberapa instance, tiap instance
> punya counter sendiri). Tes lokal membuktikan *logikanya benar*; perilaku production diverifikasi
> di preview deployment (lihat bagian terakhir).

Prasyarat: `npm run dev` jalan (contoh di bawah memakai port 3000; sesuaikan bila berbeda).
Perintah ditulis untuk **Git Bash**; padanan PowerShell ada di bagian akhir.

---

## Ringkasan hasil eksekusi 2026-08-06 (dev lokal, Next 16.2.7)

| # | Uji | Harapan | Hasil |
|---|-----|---------|-------|
| 1 | `orders/create` ×5 | `422 422 422 429 429` | ✅ persis |
| 2 | `track-by-phone` nomor asing ×7 | 5× `200 {"orders":[]}` lalu `429` | ✅ persis |
| 2b | nomor lain dari IP sama | `200` (bucket per-nomor terpisah) | ✅ |
| 3 | `reviews/create` ×3 → `reviews/create-by-phone` ×1 | `422 422 422` lalu `429` (bucket dipakai bersama) | ✅ |
| 4 | keyword search 150 karakter | `400 Keyword terlalu panjang.` | ✅ |
| 5 | `shipping/estimate` ×22 | 20× `400` lalu `429` | ✅ |
| 5b | `shipping/estimate` param asli (setelah window reset) | data kurir sungguhan | ✅ `JNE estimatedSpecialPrice: 10900` |
| 6 | Log server saat limit terpicu | baris `[rate-limit] terpicu: …` | ✅ 7 baris |
| A | **Nomor asli** (punya pesanan) ×10 | `200` sepuluh kali, nol `429` | ✅ nol `429` |
| B | IP sama, nomor asing ×6 | 5× `200` lalu `429` | ✅ persis |
| C | IP sama, balik ke nomor asli **setelah** B kena limit | `200` | ✅ tak kena getahnya |
| D | `verify-cancel` pasangan invoice+nomor benar | `match:true, cancellable:true` | ✅ |
| E | `verify-cancel` nomor salah ×6 | 5× `match:false` lalu `429` | ✅ persis |
| F | `reviewable-by-phone` nomor asli ×3 | `200` semua | ✅ |
| G | Output `track-by-phone` | nama ter-mask | ✅ `"P****a"`, `"l**u"` |

> Uji A–G dijalankan dengan header `X-Forwarded-For` IP dokumentasi (RFC 5737: `203.0.113.10`,
> `198.51.100.7`) agar tiap skenario mulai dari bucket bersih — `getClientIp()` memang membaca
> header itu lebih dulu. Di production header ini di-set Vercel, bukan klien.

---

## 1 · Checkout / create order — 3 per menit per IP

```bash
for i in 1 2 3 4 5; do
  printf "req %d -> " "$i"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/orders/create \
    -H "Content-Type: application/json" -d '{}'
done
```

Harapan: `422 422 422 429 429`. Payload kosong sengaja dipakai — `422` membuktikan request
menembus validasi (belum kena limit), `429` di request ke-4 membuktikan limiter memblokir
**sebelum** pekerjaan DB apa pun dijalankan.

## 2 · Brute-force nomor telepon — 5 percobaan GAGAL per 15 menit per (IP + nomor)

Pakai nomor yang **pasti tidak punya pesanan**:

```bash
for i in 1 2 3 4 5 6 7; do
  printf "req %d -> " "$i"
  curl -s -w " [%{http_code}]\n" -X POST http://localhost:3000/api/orders/track-by-phone \
    -H "Content-Type: application/json" -d '{"phone":"081299998888"}'
done
```

Harapan: 5× `{"orders":[]} [200]` lalu `[429]` dengan pesan generik.

Bucket per-nomor terpisah — nomor lain dari IP yang sama masih dilayani sampai batas per-IP
(20/15 menit) tercapai:

```bash
curl -s -X POST http://localhost:3000/api/orders/track-by-phone \
  -H "Content-Type: application/json" -d '{"phone":"081277776666"}'
```

Endpoint `verify-cancel` dan `reviewable-by-phone` memakai pola identik (ganti URL + tambahkan
`"orderId"` untuk `verify-cancel`).

### 2b · WAJIB: buktikan user normal TIDAK ke-block

Ini uji terpenting — limit per (IP+nomor) hanya menghitung percobaan **gagal**, jadi pemilik nomor
tidak boleh pernah kena. Ambil nomor telepon dari pesanan asli (OMS → Orders), lalu:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/orders/track-by-phone \
    -H "Content-Type: application/json" -d '{"phone":"08xxxxxxxxxx"}'
done
```

Harapan: **`200` sepuluh kali, tanpa satu pun `429`.** Kalau muncul `429`, logika "hitung yang gagal
saja" rusak → jangan deploy.

Sudah dijalankan 2026-08-06 dengan nomor dummy `089675844180` (pesanan `INV-20260727-3436`):
10× `200` berisi data pesanan, nol `429`. Lalu dari **IP yang sama** nomor asing ditembak 6× →
`429` di percobaan ke-6, dan request berikutnya untuk nomor asli tetap `200`. Artinya blokir
menempel pada pasangan (IP, nomor yang ditebak), bukan menyeret pemilik nomor asli.

Ulangi di browser: buka `/track-order` (nomor auto-terisi dari cookie `infarm_phone`) lalu reload
8×. Daftar pesanan harus tetap muncul setiap kali.

## 3 · Spam ulasan — 3 per 10 menit per IP (bucket dipakai bersama)

```bash
for i in 1 2 3; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/reviews/create \
    -H "Content-Type: application/json" -d '{}'
done
curl -s -X POST http://localhost:3000/api/reviews/create-by-phone \
  -H "Content-Type: application/json" -d '{}'
```

Harapan: `422 422 422` lalu **`429` dari endpoint yang berbeda** — membuktikan bot tak bisa memecah
spam ke dua endpoint review karena keduanya berbagi bucket `reviews-create:ip:<ip>`.

> ⚠️ Konsekuensi UX yang diketahui: pembeli yang mengulas >3 produk dalam 10 menit akan tertahan.
> Longgarkan lewat `RATE_LIMITS.REVIEW_CREATE_IP` bila ada keluhan.

## 4 · Proxy Mengantar — 20 per menit per IP + batas panjang keyword

```bash
# search alamat
for i in $(seq 1 22); do
  curl -s -o /dev/null -w "%{http_code} " "http://localhost:3000/api/mengantar/address/search?keyword=cibinong"
done; echo

# cek ongkir — param invalid sengaja: limiter dicek SEBELUM upstream ditembak
for i in $(seq 1 22); do
  curl -s -o /dev/null -w "%{http_code} " "http://localhost:3000/api/mengantar/shipping/estimate?destination_id=&weight=0"
done; echo

# batas panjang keyword
curl -s "http://localhost:3000/api/mengantar/address/search?keyword=$(printf 'a%.0s' $(seq 1 150))"
```

Harapan berturut-turut: 20× `200` lalu `429` · 20× `400` lalu `429` ·
`{"error":"Keyword terlalu panjang."}`.

Bahwa deretan `400` **tidak** menyentuh Mengantar sama sekali adalah intinya: limiter berdiri di
depan pemanggilan upstream, jadi tidak bisa dipakai sebagai relay gratis.

## 5 · Regresi checkout (WAJIB — jalur ongkir berubah)

Cek ongkir yang dulu di-fetch langsung browser→Mengantar kini lewat proxy internal. Uji manual:

1. Buka `/checkout` dengan isi keranjang.
2. Ketik alamat di kolom search → hasil muncul (proxy search OK).
3. Pilih alamat → daftar kurir + ongkir muncul (**proxy ongkir baru OK**).
4. Pilih kurir → "Bayar Sekarang" aktif → submit → order tersimpan.

Bila daftar kurir kosong/gagal, periksa `MENGANTAR_ORIGIN_ID` atau `NEXT_PUBLIC_MENGANTAR_ORIGIN_ID`
di `.env.local` — origin kini dibaca di server, bukan di klien.

## 6 · Log peringatan (deteksi dini brute-force)

Setiap `429` menulis satu baris ke log server:

```bash
grep "\[rate-limit\] terpicu" .next/dev/logs/next-development.log | tail -5
```

Contoh hasil nyata:

```
WARN [rate-limit] terpicu: track-by-phone:miss:::1:081299998888 (max 5/900000ms)
WARN [rate-limit] terpicu: reviews-create:ip:::1 (max 3/600000ms)
WARN [rate-limit] terpicu: mengantar-ongkir:ip:::1 (max 20/60000ms)
```

Di production baris ini muncul di **Vercel → Logs** (filter `[rate-limit]`). Lonjakan mendadak =
sinyal serangan.

## 7 · Reset counter

Counter in-memory → **restart dev server = semua counter hilang**. Ini memang sifat pendekatan
sekarang, bukan bug. Kalau perlu menguji ulang tanpa menunggu window habis, restart server.

---

## Verifikasi di preview deployment Vercel

Ulangi **uji 2** terhadap URL preview. Kalau butuh lebih dari 5 percobaan sampai kena `429`,
itu efek multi-instance (tiap instance punya counter sendiri) — bukan bug, tapi indikator kapan
pindah ke penyimpanan bersama (Upstash Redis) jadi perlu. Catat angkanya sebagai baseline.

## Padanan PowerShell

```powershell
# 1 — orders/create
1..5 | ForEach-Object {
  try {
    Invoke-WebRequest -Uri http://localhost:3000/api/orders/create -Method POST `
      -ContentType 'application/json' -Body '{}' -UseBasicParsing | Out-Null
  } catch { "$_.Exception.Response.StatusCode.value__" }
}

# 2 — track-by-phone (nomor asing)
1..7 | ForEach-Object {
  try {
    (Invoke-WebRequest -Uri http://localhost:3000/api/orders/track-by-phone -Method POST `
      -ContentType 'application/json' -Body '{"phone":"081299998888"}' -UseBasicParsing).StatusCode
  } catch { $_.Exception.Response.StatusCode.value__ }
}
```

`Invoke-WebRequest` melempar exception pada status ≥400, jadi `429` muncul lewat blok `catch` —
itu perilaku normal, bukan error skrip.
