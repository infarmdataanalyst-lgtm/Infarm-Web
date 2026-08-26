# E2E Test (Playwright)

Berkas uji end-to-end. **Belum ada test case** — folder ini baru berisi kerangkanya.

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
