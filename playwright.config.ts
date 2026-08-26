// playwright.config.ts
// Konfigurasi E2E testing. HANYA untuk pengujian lokal/CI — tak ada kode aplikasi yang mengimpor
// file ini, dan `next build` tak menyentuhnya sama sekali.
//
// ── Kenapa memakai Chrome terpasang, bukan Chromium bawaan Playwright ──
// `channel: 'chrome'` memakai Chrome yang sudah ada di mesin, jadi tak ada browser 240MB yang perlu
// diunduh (`npx playwright install` tidak dijalankan sama sekali). Konsekuensinya versi browser
// mengikuti Chrome di mesin masing-masing.
//
// Saat E2E kelak dijalankan di CI, HAPUS `channel` di sana dan pakai Chromium bawaan Playwright:
// versinya terkunci sehingga hasil uji sama di tiap mesin — sesuatu yang tak bisa dijamin oleh
// Chrome yang memperbarui dirinya sendiri.

import { defineConfig, devices } from '@playwright/test'

// Alamat dev server Next.js proyek ini (`npm run dev`).
// Bisa ditimpa lewat env untuk menguji deployment preview:
//   PLAYWRIGHT_BASE_URL=https://xxx.vercel.app npx playwright test
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// Apakah sedang berjalan di CI. Beberapa pengaturan sengaja lebih ketat di sana.
const IS_CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/e2e',

  // Jalankan file uji secara paralel. Aman untuk pengujian BACA; begitu ada uji yang menulis ke
  // Supabase (mis. membuat pesanan), uji itu harus diberi `test.describe.serial` sendiri —
  // dua checkout paralel akan berebut stok produk yang sama.
  fullyParallel: true,

  // Di CI, `test.only` yang lolos ter-commit akan membuat sisa uji terlewat DIAM-DIAM.
  // Lebih baik build-nya gagal daripada laporan hijau yang sebetulnya cuma menjalankan satu uji.
  forbidOnly: IS_CI,

  // Retry hanya di CI. Di lokal, uji yang gagal harus terlihat gagal langsung — retry otomatis
  // menyembunyikan flakiness yang justru perlu diperbaiki.
  retries: IS_CI ? 2 : 0,

  // Satu worker di CI (runner-nya kecil); lokal biarkan Playwright memakai inti yang tersedia.
  workers: IS_CI ? 1 : undefined,

  // `list` untuk keluaran terminal, `html` untuk laporan yang bisa ditelusuri (jejak, screenshot,
  // langkah per aksi) lewat `npx playwright show-report`.
  //
  // HTML dinyalakan di LOKAL juga, bukan hanya CI: laporan itu justru paling berguna saat menelusuri
  // kegagalan di mesin sendiri, dan sebelumnya `show-report` selalu menjawab "No report found".
  //
  // `open: 'never'` — jangan pernah membuka browser sendiri. Tanpa itu, satu kegagalan di CI
  // menggantung menunggu peramban yang tak akan pernah ada. Buka manual dengan `show-report`.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,

    // Jejak hanya disimpan saat percobaan ulang pertama — cukup untuk membedah kegagalan tanpa
    // menumpuk berkas besar pada uji yang lolos.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',

    // Storefront ini berbahasa Indonesia & memakai zona WIB. Menyamakannya di sini mencegah uji
    // yang lolos di mesin lokal tapi gagal di CI hanya karena format tanggal/mata uang berbeda.
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  },

  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        // Chrome yang terpasang di mesin — bukan Chromium unduhan Playwright.
        channel: 'chrome',
      },
    },
  ],

  // Dev server dijalankan otomatis saat `npx playwright test`.
  //
  // `reuseExistingServer` di lokal: kalau `npm run dev` sudah menyala, Playwright memakainya
  // alih-alih menyalakan yang kedua dan bertabrakan di port 3000. Di CI selalu dinyalakan sendiri.
  //
  // CATATAN: memakai `npm run dev`, BUKAN `npm run build && npm run start`. Uji jadi cepat berulang,
  // tapi perilaku yang HANYA ada di production — ISR/`revalidate`, cache tag, header `x-vercel-cache`
  // — tak bisa diuji dari sini (lihat catatan caching di CLAUDE.md). Untuk itu jalankan uji terhadap
  // deployment preview lewat PLAYWRIGHT_BASE_URL.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
  },
})
