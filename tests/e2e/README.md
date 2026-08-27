# E2E Test (Playwright)

Berkas uji end-to-end.

| Spec | Menulis data? | Jalan otomatis? |
|---|---|---|
| `checkout-address-fields.spec.ts` | tidak | ya |
| `checkout-special-chars.spec.ts` | tidak | ya |
| `checkout-ongkir-flow.spec.ts` | tidak | ya |
| `checkout-full-payment-flow.spec.ts` | **YA — pesanan, invoice, resi** | **tidak** (lihat di bawah) |

## Menjalankan

```bash
npx playwright test              # semua uji (dev server dinyalakan otomatis)
npx playwright test --ui         # mode UI, enak untuk menulis uji baru
npx playwright test --headed     # lihat browsernya bekerja
npx playwright show-report       # buka laporan HTML terakhir
```

Dev server tak perlu dinyalakan manual — `webServer` di `playwright.config.ts` yang mengurusnya.
Kalau `npm run dev` sudah menyala, Playwright memakainya (`reuseExistingServer`).

## Browser

Memakai **Chrome yang terpasang di mesin** (`channel: 'chrome'`), bukan Chromium unduhan
Playwright. Karena itu `npx playwright install` **tidak perlu dijalankan** dan tak ada ~240MB
binary yang diunduh.

Kalau Chrome tak ada di mesin, dua jalan keluar:
- ganti `channel: 'chrome'` → `channel: 'msedge'` (Windows selalu punya Edge), atau
- hapus barisnya lalu jalankan `npx playwright install chromium`

## Menguji deployment lain

```bash
PLAYWRIGHT_BASE_URL=https://xxx.vercel.app npx playwright test
```

Perlu untuk apa pun yang hanya hidup di production: ISR/`revalidate`, `revalidateTag`, dan header
`x-vercel-cache` tak berlaku di `next dev` (lihat CLAUDE.md → Caching & Revalidasi).

## ⚠️ Sebelum menulis uji yang MENULIS data

Uji berjalan `fullyParallel`. Aman untuk pembacaan, tapi begitu sebuah uji membuat pesanan
sungguhan:

- Bungkus dengan `test.describe.serial` — dua checkout paralel berebut stok produk yang sama.
- Ingat checkout **memotong stok** dan **menerbitkan invoice Xendit**. Jangan pernah menjalankan
  uji semacam itu dengan kunci Xendit produksi.
- Booking kurir (`POST /order` Mengantar) **memotong saldo dan menerbitkan resi nyata**. Aturan
  panggilan API berbayar di CLAUDE.md berlaku penuh di sini — jangan memicunya dari uji otomatis.

## ⛔ `checkout-full-payment-flow.spec.ts`

Satu-satunya uji yang menembus batas pembayaran. **Dilewati secara default** dan hanya berjalan
bila sakelar izinnya dinyalakan sengaja:

```bash
E2E_ALLOW_PAID=1 npx playwright test checkout-full-payment-flow --headed
```

Sekali jalan ia meninggalkan: satu baris `orders` + `order_items`, stok berkurang, satu invoice di
dashboard Xendit, dan — **bila webhook terjangkau** — satu resi Mengantar yang tak bisa dibatalkan
dari sisi kita. Baca blok peringatan di kepala berkasnya sebelum menjalankan.

**Di localhost, verifikasi status TIDAK akan berhasil.** Server Xendit tak bisa mengirim callback
ke `http://localhost:3000`, jadi `status_pembayaran` tetap `Menunggu` dan `no_tracking` tetap
kosong meski halaman sukses terbuka. Itu juga berarti booking kurir tak terpicu di lokal.
Untuk memverifikasinya sungguhan: tunnel (`ngrok`) atau deployment preview dengan webhook
terdaftar — dan sadari bahwa di situ resinya benar-benar terbit.

**Tujuan wajib DKI Jakarta.** Sandbox Mengantar hanya melayani rute gudang Jakarta → tujuan
Jakarta; tujuan luar Jakarta mengembalikan daftar kurir kosong dan uji gagal karena data pihak
ketiga, bukan karena kode kita. Spec memeriksa kolom Provinsi tepat setelah alamat dipilih supaya
penyebabnya kelihatan di situ, bukan menjelma jadi "tak ada opsi kurir" satu langkah kemudian.

Selektor halaman Xendit di spec itu masih **tebakan berlapis kandidat**, bukan hasil pengamatan
(halamannya tak bisa diintip tanpa menerbitkan invoice lebih dulu). Jalankan sekali, lihat
`screenshots/xendit-1-metode.png`, `screenshots/xendit-2-va.png`, dan dump struktur di konsol,
lalu kunci selektornya.
