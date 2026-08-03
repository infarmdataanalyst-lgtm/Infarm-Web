# Rencana Ganti Palet Warna Brand — infarm.id

**Status**: 🟡 Menunggu keputusan warna baru. Audit sudah selesai (2026-07-30) — begitu warna baru
ditentukan, tinggal jalankan langkah di bagian "Runbook eksekusi" di bawah.

## Ringkasan temuan audit

Ada **dua sistem warna berjalan paralel**:

| | Token `brand-*` (`tailwind.config.ts`) | Class `emerald-*` (Tailwind bawaan, hardcoded) |
|---|---|---|
| Cakupan | 162 pemakaian di 49 file | 140 pemakaian di 21 file |
| Area | Storefront publik (home, produk, keranjang, checkout, track, dll) | **OMS dashboard** (mayoritas) + beberapa halaman guest |
| Efek ganti nilai di `tailwind.config.ts` | Ikut berubah otomatis | **Tidak ikut berubah** — nama warna literal, bukan token |

Kesimpulan: mengganti 3 nilai hex di `tailwind.config.ts` (`brand.primary`/`brand.light`/`brand.surface`)
**cukup** untuk merapikan storefront, tapi **OMS dashboard + 7 halaman guest di bawah harus di-cari-ganti
manual** (`emerald-*` → `brand-*` yang setara) supaya ikut konsisten.

## Token warna saat ini (`tailwind.config.ts`)

```ts
brand: {
  primary: '#46B33C', // hijau utama: section, tombol, navbar, footer
  light: '#96D296',   // hijau muda: card, badge, hover
  surface: '#F5FFEF',  // background halaman (putih kehijauan), input
}
```

## File yang PERLU diganti manual (`emerald-*` → `brand-*`)

### OMS dashboard (13 file — tombol primer, focus ring, badge status, sidebar)

| File | Jumlah |
|---|---|
| `src/app/oms/dashboard/products/page.tsx` | 13 |
| `src/components/oms/PromotionForm.tsx` | 12 |
| `src/app/oms/dashboard/reviews/page.tsx` | 12 |
| `src/components/oms/ComboForm.tsx` | 11 |
| `src/app/oms/dashboard/page.tsx` | 10 |
| `src/app/oms/dashboard/orders/page.tsx` | 10 |
| `src/components/oms/Sidebar.tsx` | 9 (termasuk `bg-emerald-950` background sidebar — perlu padanan gelap brand) |
| `src/app/oms/dashboard/paket-combo/page.tsx` | 9 |
| `src/components/oms/VariantManagerModal.tsx` | 8 |
| `src/components/oms/OrderStatusModal.tsx` | 8 |
| `src/app/oms/login/page.tsx` | 8 |
| `src/app/oms/dashboard/promosi/page.tsx` | 8 |
| `src/app/oms/dashboard/products/upload/page.tsx` | 8 |
| `src/components/oms/OmsHeader.tsx` | 2 |

### Halaman guest/publik yang "salah token" (7 file — tombol/ikon "berhasil"/aktif, bukan semantik beda)

| File | Jumlah | Peran |
|---|---|---|
| `src/components/track/TrackingTimeline.tsx` | 3 | Warna step aktif timeline lacak pesanan |
| `src/components/order-cancellation/OrderCancellationView.tsx` | 3 | Badge status "Selesai" + ikon centang sukses |
| `src/components/product/ProductReviews.tsx` | 2 | Tombol filter kategori ulasan aktif |
| `src/components/track/TrackSearchForm.tsx` | 1 | Focus ring input pencarian |
| `src/components/product/CartToast.tsx` | 1 | Ikon toast "berhasil ditambahkan ke keranjang" |
| `src/app/review/page.tsx` | 1 | Toast sukses submit review |
| `src/app/cancel-order/page.tsx` | 1 | Banner "nomor cocok, pesanan bisa dibatalkan" |

**Total: 21 file, 140 pemakaian.**

## Temuan tambahan — warna menyimpang dari aturan CLAUDE.md (biru/sky tanpa konfirmasi)

Kemungkinan bug/inkonsistensi lama, bukan disengaja. Putuskan saat eksekusi apakah ikut dirapikan:

| File:baris | Pemakaian |
|---|---|
| `src/app/oms/dashboard/orders/page.tsx:615` | Badge status order "Diproses" pakai `text-blue-600` |
| `src/app/oms/dashboard/page.tsx:93` | Salah satu accent card ringkasan dashboard pakai `bg-blue-50 text-blue-600` |
| `src/components/home/HeroSection.tsx:31` | Gradient dekoratif hero pakai `from-sky-200 via-sky-100` |

## JANGAN diganti — pengecualian fungsional resmi (semantik status, bukan brand)

Sesuai CLAUDE.md, warna berikut **tetap** dipakai apa pun brand color-nya:

| Warna | Jumlah file | Kegunaan |
|---|---|---|
| `rose` | 7 | Aksi destruktif (mis. tombol "Batalkan Pesanan") |
| `amber` | 12 | Badge stok menipis / warning |
| `orange` | 4 | Banner peringatan |
| `slate` | 14 | Tombol sekunder netral |

---

## Runbook eksekusi (jalankan setelah warna baru ditentukan)

1. **Update token brand** di `tailwind.config.ts` — ganti `primary`/`light`/`surface` ke hex baru.
   Storefront (49 file, 162 pemakaian) otomatis ikut berubah — tidak perlu sentuh file lain.
2. **Tentukan padanan shade** untuk tiap kelas `emerald-*` yang dipakai (lihat daftar di atas):
   umumnya `emerald-600/700/800` → `brand-primary` (dengan `hover:brightness-90` seperti pola
   storefront), `emerald-50/100` → `brand-surface`/`brand-light` tergantung konteks (background
   lembut vs badge), `emerald-950` (sidebar) → butuh shade gelap baru (brand-primary belum
   punya varian gelap — pertimbangkan tambah `brand.dark` di `tailwind.config.ts` bila hue baru
   butuh kontras gelap untuk sidebar).
3. **Cari-ganti per file** (21 file OMS + guest di atas) — bisa pakai Grep→Edit satu per satu
   agar tetap terkontrol (jangan sed massal tanpa review, karena tiap file bisa punya kombinasi
   shade berbeda: warna teks vs background vs border vs focus-ring).
4. **(Opsional)** Rapikan 3 temuan biru/sky yang menyimpang aturan CLAUDE.md — tanyakan dulu ke
   user apakah itu disengaja atau memang perlu diseragamkan ke brand color.
5. **Jangan sentuh** kategori pengecualian fungsional (rose/amber/orange/slate) di atas.
6. **Verifikasi visual** setelah selesai: buka minimal `/`, `/products`, `/produk/[id]`,
   `/keranjang`, `/checkout`, `/oms/login`, `/oms/dashboard`, `/oms/dashboard/products`,
   `/track-order`, `/cancel-order`, `/review` — pastikan tidak ada sisa hijau lama yang
   ketinggalan dan kontras teks/background tetap terbaca (terutama badge status & sidebar gelap).
7. Jalankan `npx tsc --noEmit` (perubahan ini murni class string, harusnya tidak memengaruhi tipe,
   tapi tetap jalankan sebagai jaring pengaman standar project).

**Audit sumber**: hasil investigasi read-only pada 2026-07-30, sebelum keputusan warna baru dibuat.
