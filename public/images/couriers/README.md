# Logo Kurir

Logo yang tampil di baris "Metode Pengiriman" dan di bottom sheet "Pilih Kurir Pengiriman"
pada halaman checkout.

## Menambah logo kurir baru

1. Simpan filenya di folder ini.
2. Tambahkan satu baris di `src/lib/courier-logo.ts` → `COURIER_LOGOS`.

Tidak ada kode lain yang perlu disentuh; ukuran & padding sudah ditangani
`src/components/checkout/CourierLogo.tsx`.

## Nama file

Nama file = **kode kurir dari respons cek ongkir Mengantar**, huruf kecil:

| Kurir | `courier.id` | Nama file |
|---|---|---|
| J&T Express | `JT` | `jt.png` |
| JNE | `JNE` | `jne.png` |
| SiCepat | `SiCepat` | `sicepat.png` |

Kode dinormalkan oleh `normalizeCourierKey()` (huruf besar, buang non-alfanumerik), jadi
`'J&T'` dari `orders.nama_ekspedisi` dan `'JT'` dari API menghasilkan logo yang sama.

## Spesifikasi gambar

- **Format**: PNG dengan latar transparan (SVG belum didukung `CourierLogo`).
- **Ukuran**: bujur sangkar, sisi 128–512px. Dirender `object-contain` di kotak 44px (sheet) /
  36px (baris trigger), jadi rasio aslinya tidak akan terdistorsi walau tiap kurir beda dimensi.
- **Warna**: versi BERWARNA, bukan putih — kotaknya selalu berlatar putih (termasuk saat kartu
  terpilih berlatar hijau muda), jadi logo putih akan hilang.
- **Margin**: jangan beri padding bawaan di dalam PNG; komponen sudah menambah `p-1`.

Logo yang belum tersedia otomatis jatuh ke ikon truk generik — tidak akan muncul gambar rusak.
