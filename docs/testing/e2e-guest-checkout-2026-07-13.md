# Laporan E2E — Guest Checkout

- **Tanggal:** 2026-07-13
- **Cakupan:** alur guest checkout (beranda → keranjang → checkout → sukses). OMS/payment/shipping-booking di luar cakupan.
- **Sifat:** testing read-only — tidak ada kode diubah.

> **Keterbatasan sesi:** environment tak punya browser automation → klik UI, bottom sheet, dan **error console browser TIDAK bisa dicek**. Yang diuji-runtime = lapisan **API/data** (dev server `localhost:3000` via HTTP). Bagian UI-only diverifikasi lewat **baca kode**. Ditandai jelas di bawah.

---

## Hasil per step

| Step | Metode | Hasil | Waktu |
|---|---|---|---|
| 1. Beranda → pilih produk → +keranjang | statik (kode) | `cart-client` cookie base64 + custom event — **tak di-drive** | – |
| 1b. `GET /api/products/list` (data katalog) | runtime | ✅ 200, 12 produk (10 aktif stok>0) | ⚠️ 2.1–4.0s |
| 2. Keranjang: total & recently viewed | statik | kalkulasi & filter arsip/in-cart benar — **tak di-drive** (localStorage) | – |
| 3. Search alamat (Mengantar) | runtime | ✅ 200, 20 hasil, `destination_id` OK | 0.61s |
| 4. Cek ongkir / pilih kurir | runtime | ✅ 200, 16 kurir (15 tersedia), harga+estimasi | 0.84s |
| 4b. Bottom sheet kurir (UI) | statik | `ShippingOptions` — **tak di-drive** | – |
| 5. Isi data pembeli + gating wajib | runtime | ✅ semua payload invalid → **422** | <0.15s |
| 6. Submit checkout | runtime | ✅ 201, order tersimpan | 2.04s |
| 7. Format invoice | runtime | ✅ `INV-20260713-5658` — **VALID** (`INV-YYYYMMDD-4digit`) | – |
| 6b. Redirect ke success | statik | checkout `router.push(?invoice=)` → success baca `getOrderByOrderId` (terverifikasi jalan) | – |

### Detail runtime yang diverifikasi
- **products/list:** 12 produk, 10 aktif & stok>0. Contoh id `399424a8-…` harga 75.000 stok 116.
- **Mengantar search** `keyword=menteng`: 20 hasil, `_id` kelurahan terpakai sebagai `destination_id`.
- **Cek ongkir** origin→menteng, weight 1kg: 16 kurir, 15 tersedia (mis. SiCepat Rp8.400, JNE Rp10.900).
- **Happy path order:** status `Menunggu Pembayaran` / paymentStatus `Menunggu`, total 83.400.
  Order test dibatalkan setelahnya (stok dikembalikan) — tersisa baris CANCELLED (artifact).

### Gating "langkah wajib tak bisa dilewati" — semua ditolak server (422)
tanpa alamat · `destination_id` kosong · items kosong · tanpa nama · quantity 0 · body non-objek.
Plus lapisan client: tombol Bayar `canPay = isAddressValid && selectedCourier`, dan `handlePay`
double-guard (`revealErrors()` + cek kurir + toast). **Dua lapis (client + server) — bagus.**

---

## Temuan

### 🟠 SEDANG · Latensi & payload `GET /api/products/list` — ✅ RESOLVED (2026-07-13)
- **5.0 MB** per request; warm **~2.1–2.6s** (cold 4.0s). Bukan cold-compile (hit#2 tetap 2.1s).
- **Sebab:** foto produk disimpan **base64 data-URL** (`image_url` + galeri `images[]`) dan dikirim
  **penuh** di list. Satu produk ~150KB+.
- **Dampak:** endpoint dipanggil di katalog, keranjang, **checkout**, dan form review → semua berat +
  boros bandwidth (fatal di mobile).
- **Perbaikan (2026-07-13):** foto dipindah ke Supabase Storage (bucket `product-images`);
  `image_url`/`images` kini berisi URL, bukan base64. `saveProduct`/`updateProduct` auto-upload
  data-URL → Storage; data lama dimigrasi via `scripts/migrate-product-images-to-storage.mjs`.
  **Payload terukur ulang: `products/list` 5.0MB → ~20KB; `best-selling-catalog` >1MB → ~3.5KB.**

### 🔴 TERKAIT AUDIT · Harga & total dari client dipercaya (K-3, masih terbuka)
- Happy path membuktikan server **menerima `totalAmount` apa adanya** (83.400 tak dihitung ulang);
  `price_at_purchase` juga dari client.
- Bukan temuan baru — ini **K-3** di `docs/security/audit-2026-07-08.md` (belum diperbaiki). Relevan
  karena bagian inti alur checkout.

### 🔵 Catatan kecil
- `ORDER_DISCOUNT` di ringkasan checkout masih konstanta dummy (`dummy-checkout`), bukan promo real →
  total bisa beda dari niat promo. (Wiring promo→order memang roadmap.)
- **Error console browser: tak terverifikasi** (tak ada browser). Perlu cek manual di DevTools.
- Step 1, 2, 4b (interaksi UI murni): tak di-drive; hanya statik.

---

## Ringkasan
Alur data checkout **berfungsi end-to-end**: produk → alamat → ongkir → submit → order tersimpan →
invoice format benar → redirect. Validasi wajib solid (client + server 422). Status dua temuan:
**performa `products/list` ✅ SUDAH DIPERBAIKI** (foto → Storage, 5MB → ~20KB) dan **kepercayaan harga
dari client (K-3) masih terbuka**.

### Prioritas usulan
1. ~~`products/list` — payload 5MB~~ → ✅ selesai 2026-07-13 (foto pindah ke Supabase Storage).
2. K-3 — butuh keputusan desain harga (server hitung ulang dari DB). **Masih terbuka.**
