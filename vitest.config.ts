// vitest.config.ts
// Konfigurasi UNIT TEST. Berbeda tujuan dari Playwright (playwright.config.ts):
//
//   Playwright  → menjalankan aplikasi sungguhan di browser, dengan dev server dan Supabase hidup.
//                 Lambat, butuh banyak prasyarat, dan sengaja TIDAK dipasang di gerbang PR.
//   Vitest      → menjalankan SATU fungsi terpisah, tanpa browser, tanpa jaringan, tanpa database.
//                 Cukup cepat untuk ikut di gerbang PR (`npm run test:unit` di .github/workflows/ci.yml).
//
// Keduanya tidak tumpang tindih: Playwright membaca `tests/e2e`, Vitest hanya `tests/unit`.
//
// Yang layak diuji di sini: aturan yang MAHAL kalau salah dan MURAH diuji — perhitungan uang,
// berat kirim, dan keputusan boleh/tidak. Yang menyentuh Supabase, Mengantar, atau Xendit tetap
// milik Playwright dan uji sandbox manual.

import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // Sama dengan `paths` di tsconfig.json. Vitest tak membaca tsconfig, jadi alias ini harus
      // ditulis ulang di sini — kalau tidak, seluruh import '@/lib/...' gagal diselesaikan.
      '@': fileURLToPath(new URL('./src', import.meta.url)),

      // `server-only` sengaja melempar galat begitu diimpor di luar React Server Component. Itu
      // penjaga yang kita pasang sendiri (lihat mengantar-cancel.ts) dan TIDAK boleh dicabut: ia
      // yang membuat kebocoran MENGANTAR_API_KEY ke bundle klien menjadi galat build.
      //
      // Di Vitest penjaga itu tak punya makna — tak ada bundle klien, tak ada browser — sementara
      // galatnya membuat modul server mustahil diuji sama sekali. Jadi khusus di sini ia diganti
      // modul kosong. Aplikasi yang berjalan tetap memakai paket aslinya.
      'server-only': fileURLToPath(new URL('./tests/unit/stub-server-only.ts', import.meta.url)),
    },
  },
})
