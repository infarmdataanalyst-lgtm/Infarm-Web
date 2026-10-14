# Impor produk massal (spreadsheet + foto)

Untuk menambah **banyak produk sekaligus** tanpa lewat OMS. Skrip `scripts/import-produk.ts` berjalan
di laptop admin, mengolah foto, lalu menulis langsung ke Supabase. Vercel tidak terlibat.

Perubahan kecil sehari-hari (ubah harga satu produk, arsipkan, dll.) tetap lewat OMS.

## Alur

| Langkah | Siapa | Apa |
|---|---|---|
| 1 | Tim sales | Isi spreadsheet dari template, taruh foto di folder Drive yang sama |
| 2 | Admin | Unduh folder Drive (otomatis jadi ZIP), jalankan **periksa** |
| 3 | Tim sales | Perbaiki kesalahan dari laporan (bila ada) |
| 4 | Admin | Jalankan **simpan** |
| 5 | Tim gudang | Isi stok di OMS → Gudang → Kelola Stok |
| 6 | Admin | Tampilkan produk: OMS → Produk → pilih → Pulihkan |

## Spreadsheet

Template: [`scripts/templates/template-impor-produk.csv`](../scripts/templates/template-impor-produk.csv)
(buka di Google Sheets: File → Impor). Judul kolom harus persis, urutan kolom bebas.

| Kolom | Wajib | Isi |
|---|---|---|
| `sku_produk` | ✅ | Huruf kapital, angka, tanda hubung. Unik. |
| `nama_produk` | ✅ | 3–200 karakter |
| `kategori` | ✅ | Benih Premium · Pupuk Nutrisi · Peralatan Berkebun · Pot Polybag · Media Tanam · Paket Berkebun |
| `deskripsi` | ✅ | 20–2000 karakter |
| `berat_gram` | ✅ | Angka bulat, gram — dipakai menghitung ongkir |
| `min_beli` | | Minimal pembelian (pcs), kosong = 1 |
| `harga_coret` | | Harga sebelum diskon, harus lebih besar dari harga jual |
| `harga_jual` | ✅ | Angka bulat; `Rp 15.000` / `15.000` / `15000` diterima |
| `nama_varian` | varian | Mis. `250 gram` |
| `sku_varian` | varian | Unik, terpisah dari SKU produk |
| `varian_utama` | | `ya` pada satu varian; kosong → varian pertama |

**Produk bervarian** = beberapa baris dengan `sku_produk` yang sama, satu baris per varian. Data
produk (nama, kategori, deskripsi, berat, min_beli, harga_coret) cukup di baris pertama. Harga produk
di katalog = harga varian utama.

**Stok tidak ada di spreadsheet.** Semua produk masuk dengan stok 0 dan **disembunyikan** dari toko
sampai tim gudang mengisi stoknya.

⚠️ **Berat hanya satu per produk** (keterbatasan sistem, berlaku juga di OMS): varian 250 g dan 1 kg
memakai berat yang sama untuk ongkir. Sampai berat per varian tersedia, isi berat **varian terberat**
supaya ongkir tidak kurang ditagih.

## Foto

Nama berkas = SKU produk. Format JPG, PNG, atau WEBP; ukuran bebas (dikecilkan otomatis ke maks.
1200 px, WebP).

| Berkas | Arti |
|---|---|
| `BNH-001.jpg` | Foto utama (tampil di katalog) |
| `BNH-001_2.jpg`, `BNH-001_3.jpg`, … | Galeri, urut sesuai angka (maks. 9 foto) |

Pemisah galeri **garis bawah** (`_`), bukan tanda hubung — `BNH-001-2` bisa saja SKU produk lain.
Huruf besar/kecil tidak berpengaruh. Varian tidak punya foto sendiri.

## Menjalankan (admin)

Dari folder repo, di terminal VS Code. Masukan boleh ZIP unduhan Drive, folder, atau berkas
`.csv`/`.xlsx` + folder/ZIP foto.

```bash
# 1. Periksa — tidak menyimpan apa pun
npm run impor-produk -- "C:\Users\...\Impor Produk\Impor 14 Okt-20261014.zip"

# 2. Simpan — hanya bila pemeriksaan bersih
npm run impor-produk -- "C:\Users\...\Impor Produk\Impor 14 Okt-20261014.zip" --simpan
```

| Tanda | Fungsi |
|---|---|
| `--simpan` | Benar-benar menyimpan |
| `--tampilkan` | Produk langsung tampil di toko (bawaan: disembunyikan) |
| `--lewati-salah` | Simpan produk yang siap, lewati yang bermasalah |

Laporan juga ditulis ke `laporan-impor-<tanggal>.txt` di samping masukan — bisa diteruskan apa adanya
ke tim sales. Produk muncul di toko ±1 menit setelah ditampilkan (cache storefront).

Simpan ZIP/CSV/foto **di luar folder repo** supaya tidak ikut ter-commit.

## Yang ditulis per produk

Sama dengan produk dari OMS: foto ke Storage `product-images/products/<uuid>.webp` (cache 1 tahun),
baris `products` (badge "Baru", stok 0), `product_variants` (stok 0), dan
`product_stock_per_warehouse` stok 0 di gudang default. Gagal di tengah jalan → produk itu dibatalkan
seluruhnya (baris & foto dihapus), skrip lanjut ke produk berikutnya. SKU yang sudah ada di database
ditolak — produk lama diubah lewat OMS.

## Catatan Google Drive

- Folder Drive yang diunduh menjadi ZIP; Google Sheets di dalamnya menjadi `.xlsx` — keduanya dibaca
  langsung, tak perlu diekstrak atau dikonversi.
- Hanya **satu** spreadsheet boleh ada di paket.
- Folder sangat besar (> ±2 GB) dipecah Drive menjadi beberapa ZIP — sebutkan semuanya di perintah.
