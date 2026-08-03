// tailwind.config.ts
// Konfigurasi Tailwind untuk warna brand infarm.
// Di Tailwind v4 file ini di-load lewat directive `@config` di src/app/globals.css.

import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      colors: {
        // Palet brand infarm (lihat Design System di CLAUDE.md)
        brand: {
          primary: '#46B33C', // hijau utama: section, tombol, navbar, footer
          light: '#96D296', // hijau muda: card, badge, hover
          surface: '#F5FFEF', // background halaman (putih kehijauan), input
          // Aksen earthy (dari dunia berkebun: tanah & biji) — untuk eyebrow, aksen, tekstur
          soil: '#6B4E3D', // cokelat tanah — teks aksen/eyebrow, kontras hangat
          cream: '#EDE3D0', // krem biji — background lembut alternatif / kartu
          dark: '#3B4A2E', // hijau zaitun gelap — header storefront (teks terang di atasnya)
          header: '#46B33C', // hijau-kuning muda — background header storefront (teks gelap)
        },
      },
    },
  },
}

export default config
