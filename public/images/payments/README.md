# Logo Metode Pembayaran

Logo yang tampil di seksi **Metode Pembayaran** halaman checkout
(`src/components/checkout/PaymentMethodsInfo.tsx`).

Seksi itu bersifat **informasi saja** — pemilihan metode terjadi di halaman Xendit. Logo di sini
hanya menjawab "nanti bisa bayar pakai apa".

## Nama file

Nama file = `slug` pada `PAYMENT_METHOD_GROUPS` di `src/lib/payment-methods.ts`, huruf kecil,
ekstensi `.png`.

| Kelompok | Slug yang dipakai sekarang |
|---|---|
| Virtual Account | `bca`, `mandiri`, `bri`, `bni` |
| E-Wallet | `dana`, `ovo`, `shopeepay` |
| QRIS | `qris` |
| Debit | `bri`, `mandiri` (berbagi file dengan VA) |

Satu file bisa dipakai beberapa kelompok — `bri.png` melayani Virtual Account maupun Debit.

## Menambah atau mengganti logo

1. Simpan PNG-nya di folder ini dengan nama sesuai slug.
2. Bila penyedianya belum terdaftar, tambahkan satu entri `{ slug, label }` di
   `src/lib/payment-methods.ts`.

Tidak ada kode lain yang perlu disentuh — ukuran, padding, dan penanganan file yang belum ada
sudah ditangani `PaymentMethodsInfo`.

## Spesifikasi gambar

- **Format**: PNG latar transparan. SVG belum didukung.
- **Ukuran**: lebar 128–512px, rasio bebas (logo pembayaran umumnya memanjang, bukan bujur
  sangkar seperti logo kurir). Dirender `object-contain` di kotak 44×28px.
- **Warna**: berwarna asli. Kotaknya selalu putih, jadi logo gelap tetap terbaca.

## Kalau filenya belum ada

Tidak apa-apa dan tidak merusak tampilan: `PaymentLogoBox` menangkap `onError` lalu menampilkan
**nama penyedia sebagai teks** di dalam kotak yang sama. Daftarnya tetap terbaca, hanya tanpa
gambar.

## ⚠️ Hak pakai logo

Logo bank dan e-wallet adalah merek dagang pemiliknya. Pakai berkas resmi dari masing-masing
penyedia (atau dari media kit Xendit) dan jangan mengubah warna atau proporsinya.
