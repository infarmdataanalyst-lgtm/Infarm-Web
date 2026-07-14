# Testing Alur Manajemen Produk OMS + Interaksi Stok

**Tanggal:** 2026-07-14
**Cakupan:** Tambah, edit, arsip produk, dan interaksi stok (termasuk race condition checkout)
**Metode:** Uji layer API/HTTP nyata (`localhost:3000`) + query DB langsung (service_role) + pembacaan kode. Tidak ada automasi browser di environment ini, jadi UI/visual diverifikasi lewat pembacaan komponen.
**Data:** Produk TEST khusus (SKU `TEST-RACE-001`, ditandai `[TEST] … Hapus Saya`). **Tidak menyentuh produk asli.** Seluruh artefak (produk + order test) dihapus otomatis di akhir.
**Status kode:** Read-only — tidak ada perbaikan kode dilakukan (sesuai instruksi).

Hasil otomatis: **10/10 skenario lolos.**

---

## Ringkasan Eksekutif

| Area | Hasil |
|------|-------|
| Race condition checkout (stok=1, 2 tab) | ✅ **AMAN** — tepat 1 sukses, 1 ditolak wajar (409). Tidak ada oversell. |
| Konsistensi data OMS → data storefront | ✅ Konsisten di sumber data (API). ⚠️ Tab storefront yang sudah terbuka perlu **reload** (lihat T-1). |
| Arsip produk | ✅ Hilang dari katalog; order lama tetap terbaca tanpa error. |
| Badge "stok habis" di storefront | ❌ **Belum ada** (lihat P-1) — produk stok 0 tetap tampil & bisa masuk keranjang. |

**Tidak ada bug kritis.** Satu temuan penting UX/logika (P-1) + satu catatan konsistensi (T-1).

---

## Skenario & Hasil

### 1. Tambah produk baru → muncul di katalog
- Produk TEST (stok 1, harga Rp75.000) berhasil dibuat.
- `GET /api/products/list` langsung mengembalikannya (`stock=1`, `promoPrice=75000`). ✅
- **Katalog storefront** (`ProductCatalog`) memfilter `!archived` saja — produk baru non-arsip langsung masuk. ✅

### 2. Edit produk (harga & stok→0) → tampilan berubah
- `PATCH /api/products/update` **dijaga admin**: tanpa sesi → **HTTP 401**. ✅ (aman, K-1)
- Setelah update (stok→0, harga→50.000), `GET /api/products/list` mencerminkan perubahan seketika (`stock=0`, `promoPrice=50000`). ✅ Data konsisten OMS↔sumber storefront.
- Endpoint update memanggil `revalidatePath('/')` & `revalidatePath('/produk')` → halaman **Server Component** (homepage, detail produk) menampilkan data terbaru pada request berikutnya tanpa aksi manual.
- ⚠️ Halaman **katalog** (`/products`) adalah **client component** yang `fetch` sekali saat mount → tab yang sudah terbuka **tidak** ikut ter-revalidate; perlu reload. Lihat **T-1**.
- **Badge "stok habis"**: tidak muncul karena memang belum diimplementasi di storefront. Lihat **P-1**.

### 3. Arsipkan produk → hilang dari katalog, order lama tidak error
- Setelah `archived=true`, produk **tidak lolos** filter katalog (`!archived`). ✅
- Titik filter arsip yang terverifikasi di kode:
  - `ProductCatalog.tsx` (katalog `/products`)
  - `HeroSection.tsx` (homepage)
  - `produk/[id]/page.tsx` (detail → dianggap tidak ada, fallback/notFound)
  - `best-selling-catalog/route.ts` (produk terlaris)
  - `keranjang/page.tsx` (rekomendasi "Dilihat Sebelumnya")
  - `orders/create/route.ts` (tolak checkout produk arsip — 422)
- **Order lama** yang memuat produk terarsip tetap terbaca via `GET /api/orders/get`; nama produk **ter-resolve** benar (`item.name="[TEST] Race Produk Hapus Saya"`), bukan fallback generik. ✅ Sebab: `resolveProductInfo` query `products` by id **tanpa** memfilter arsip → arsip ≠ hapus, data historis aman.

### 4. Race condition — stok 1, dua checkout paralel (dua tab)
Dua `POST /api/orders/create` ditembak bersamaan (`Promise.all`) untuk produk stok 1:

```
Req A → HTTP 409  {"error":"Stok produk [TEST] … tidak mencukupi"}
Req B → HTTP 201  {"success":true,"invoice":"INV-20260714-2388"}
```

| Cek | Hasil |
|-----|-------|
| Tepat 1 checkout sukses (201) | ✅ sukses=1, konflik=1 |
| Stok akhir = 0 (tidak minus/ganda) | ✅ `stock=0` |
| Hanya 1 baris `order_items` terbuat | ✅ |
| Oversell (kedua sukses)? | ✅ TIDAK terjadi |

**Jawaban atas pertanyaan laporan:**
- **Apakah ada order gagal wajar (bukan bug)?** — **Ya, dan itu yang benar.** Checkout kedua ditolak **409 "Stok tidak mencukupi"**. Ini kegagalan yang diharapkan, bukan bug.
- **Apakah keduanya bisa checkout (oversell)?** — **Tidak.** Tidak ada kebocoran stok.

**Kenapa aman:** RPC `create_order_with_items` (plpgsql, `security definer`) melakukan
`SELECT stock … FOR UPDATE` — **row lock** — sebelum mengurangi stok, semuanya dalam **satu transaksi**. Transaksi pertama mengunci baris & menurunkan stok ke 0; transaksi kedua menunggu lock, lalu melihat `stock(0) < qty(1)` → `raise exception 'INSUFFICIENT_STOCK'` → **rollback penuh**. Serialisasi terjadi di level DB, jadi aman walau app-layer memproses paralel.

---

## Temuan

### P-1 — Produk stok 0 tetap tampil & bisa masuk keranjang (belum ada badge/guard "stok habis") · Prioritas: Sedang
**Fakta:**
- Tipe publik `Product` (dipakai `ProductCard`) **tidak punya field `stock`** → kartu katalog tak bisa menandai "habis".
- `ProductCatalog` hanya memfilter `!archived`, **tidak** memfilter/menandai `stock === 0` → produk habis tampil normal.
- Halaman detail produk **tidak** menjaga stok produk utama (variabel `stockById` hanya dipakai untuk filter combo). Tombol **"+ Keranjang"** dan **"Beli Langsung"** (`StickyBuyBar`) tetap aktif untuk produk stok 0.
- Satu-satunya penjaga stok = server RPC saat "Bayar Sekarang" → buyer baru tahu "Stok tidak mencukupi" **di akhir** alur checkout.

**Dampak:** UX kurang baik — buyer bisa menambah produk habis ke keranjang dan baru gagal saat bayar. Tidak ada kebocoran data/uang (server tetap menolak).

**Saran (belum dikerjakan):** tambahkan `stock` ke data kartu + badge "Stok Habis" di `ProductCard`/`ProductInfo`, dan disable tombol beli saat stok 0. Filter/urutkan produk habis di katalog bila diinginkan.

### T-1 — Tab storefront yang sudah terbuka tidak refleksikan edit OMS tanpa reload · Prioritas: Rendah
**Fakta:** Katalog `/products` (`ProductCatalog`, client) `fetch('/api/products/list')` sekali saat mount. Edit dari OMS **tidak** otomatis muncul di tab katalog yang sudah dibuka; perlu **reload manual**. Homepage & detail (Server Component) sudah ditangani `revalidatePath` sehingga fresh pada navigasi/refresh berikutnya.

**Dampak:** minor; realtime bukan kebutuhan untuk katalog guest. Cukup didokumentasikan.

**Saran (opsional):** refetch saat window `focus`/`visibilitychange`, atau jadikan katalog Server Component ber-`revalidate`.

---

## Catatan Positif (tidak perlu tindakan)
- Endpoint tulis/baca OMS (`/api/products/update`, `/api/products/list`) dijaga `requireAdmin` (401 tanpa sesi). Checkout (`/api/orders/create`) publik sesuai desain guest.
- Arsip = soft-hide, bukan hapus → riwayat order tidak rusak.
- Harga tetap INTEGER, telepon tetap TEXT (tidak diubah).
- Harga & total order dihitung ulang server-side dari DB (K-3) — konsisten dengan snapshot `price_at_purchase`.

---

## Metodologi & Reproduksi
Script uji ada di scratchpad (`test-product-oms.mjs`), dijalankan dari root project (butuh `node_modules`). Alur: setup produk TEST → uji list → race (2× `POST /api/orders/create` paralel) → verifikasi stok & `order_items` di DB → edit (guard 401 + update via service_role) → verifikasi list → arsip + baca order lama → **cleanup** (hapus order + produk test). Semua artefak terhapus; stok/DB kembali seperti semula.
