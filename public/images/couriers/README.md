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
| Shopee Express | `spx` | `spx.png` |
| JNE | `JNE` | `jne.png` |
| SiCepat | `SiCepat` | `sicepat.png` |

Kode dinormalkan oleh `normalizeCourierKey()` (huruf besar, buang non-alfanumerik), jadi
`'J&T'` dari `orders.nama_ekspedisi` dan `'JT'` dari API menghasilkan logo yang sama.

## Spesifikasi gambar

- **Format**: PNG dengan latar **transparan** (SVG belum didukung `CourierLogo`). Latar putih akan
  terlihat sebagai kotak di kartu terpilih yang berlatar hijau muda.
- **Potong pas ke tepi logo** (sisa margin ±2%), tanpa ruang kosong di sekeliling. Sejak
  2026-10-02 logo tampil TANPA kotak/border, rata kiri, `object-contain` di area 96×40px (sheet) /
  80×32px (baris trigger) — ruang kosong di file membuat logonya tampak kecil.
- **Rasio bebas** (logo memanjang justru paling pas); lebar sisi panjang ±400–600px.
- **Warna**: versi BERWARNA, bukan putih — latar kartu putih / hijau muda.

Logo yang belum tersedia otomatis jatuh ke ikon truk generik — tidak akan muncul gambar rusak.
