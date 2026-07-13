# Laporan Testing Validasi — Checkout & Form Produk OMS

- **Tanggal:** 2026-07-13
- **Fokus:** input salah / edge case pada form checkout & form produk OMS — cari celah validasi.
- **Sifat:** read-only testing — tidak ada kode diubah.

> **Metode:** validasi **client-side** dibaca dari kode; validasi **server-side** diuji runtime via
> HTTP (kirim payload langsung ke API = **bypass client**, setara manipulasi via DevTools). Form
> produk diuji dengan sesi admin (seed `admin@infarm.id`) dan tanpa sesi. Semua artifact uji (order
> sampah, produk test) sudah dibersihkan setelah testing.

---

## A. Checkout

| Uji | Client-side | Server (bypass client) | Hasil |
|---|---|---|---|
| Email tanpa `@` / format salah | ditolak (regex `email.ts`) | **DITERIMA** | ✗ **LOLOS** — order 201 dgn email `bukan-email` |
| Telepon huruf / bukan 08 / >12 digit | ditolak (`getPhoneError`) | **DITERIMA** | ✗ **LOLOS** — phone `62abc` masuk |
| Nama <3 / alamat <10 char | ditolak (`validateAddress`) | **DITERIMA** | ✗ **LOLOS** — nama `ab`, alamat `pdk` masuk |
| Tanpa kurir / tanpa alamat | ditolak (tombol + guard `handlePay`) | ditolak (`destinationId`/`items` wajib) | ✅ 422 |
| Quantity > stok | – | ditolak RPC | ✅ **409** "Stok tidak mencukupi" |
| Harga / total negatif | – | ditolak (`totalAmount >= 0`) | ✅ 422 |

**Temuan checkout (🔴 penting):**
Validasi **format email/telepon/nama/alamat hanya client-side**. `POST /api/orders/create` cuma cek
tipe + `quantity >= 1` + `totalAmount >= 0` — **tidak** re-validate format. Bypass client → order
tersimpan dengan **email & telepon sampah**. Fatal: email/telepon dipakai untuk notifikasi &
pengiriman → order tak bisa dihubungi.
Pesan error server juga **generic**: semua kasus → `"Data pesanan tidak lengkap atau tipe data salah."`
(tak menyebut field mana).

---

## B. Form Produk OMS

| Uji | Server (dgn sesi admin) | Hasil |
|---|---|---|
| Tanpa sesi admin | ditolak | ✅ **401** (guard K-1 jalan) |
| Harga 0 / negatif | ditolak | ✅ 422 "Harga minimal Rp 100" |
| Nama kosong | ditolak | ✅ 422 |
| Nama >200 char | ditolak | ✅ 422 "maksimal 200 karakter" |
| SKU huruf kecil (format) | ditolak | ✅ 422 (pesan jelas) |
| Deskripsi <20 char | ditolak | ✅ 422 |
| Gambar 0 / >9 | ditolak | ✅ 422 (batas **9**, bukan 5) |
| **Gambar tipe salah** (`data:text/plain`) | **DITERIMA** | ✗ **LOLOS** — produk 201 dibuat |
| SKU duplikat | ditolak DB | ⚠️ **500 generic** (bukan 422) |

**Temuan produk:**
- **🟠 Gambar tak divalidasi server** — ukuran (2MB) & tipe (jpg/png/webp) hanya dicek client
  (`validateImageFile`, pakai objek `File`). `products/create` cuma cek "array string + jumlah".
  Bypass → gambar tipe salah / >2MB (base64) tersimpan. Data-URL raksasa juga memperparah payload
  `products/list` (5MB — lihat laporan E2E).
- **🟡 SKU duplikat → 500 generic** — diblokir unique constraint DB (aman dari sisi data), tapi route
  tak pre-cek duplikat → error `500` tak ramah, bukan `422` berpesan jelas. Client cek via
  `check-sku` (`exists=true` terverifikasi), tapi bypass client → user lihat 500 membingungkan.
- **ℹ️ Batas gambar 9**, bukan 5 seperti skenario (sesuai keputusan sebelumnya — bukan bug).

---

## Kesimpulan

- **Form produk OMS: validasi server-side KUAT** — semua field re-validate, pesan jelas, guard 401.
  Dua celah: **gambar (tipe/ukuran)** & **error dup SKU generic (500)**.
- **Checkout: validasi server-side LEMAH** — format email/telepon/nama/alamat **tak dicek ulang di
  server**, bisa di-bypass → data sampah tersimpan. Ini celah terpenting. (Stok & struktur sudah aman.)
- Nyambung ke **K-3** (`docs/security/audit-2026-07-08.md` — harga dari client): pola sama, checkout
  terlalu percaya client.

## Input yang lolos padahal seharusnya ditolak
1. **Checkout:** email/telepon/nama/alamat format sampah → order 201.
2. **Produk:** gambar tipe non-image → produk 201.

## Saran perbaikan (belum dikerjakan)
1. `orders/create`: re-validate email (`isValidEmail`), telepon (`isValidPhone`), nama, alamat di
   server + pesan per-field (bukan generic).
2. `products/create|update`: validasi tipe & ukuran gambar dari data-URL (parse header
   `data:image/...` + batas byte).
3. Dup SKU: pre-cek di route → balas `422` "SKU sudah digunakan" (bukan 500).
