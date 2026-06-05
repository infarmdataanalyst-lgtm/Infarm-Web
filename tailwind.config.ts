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
        },
      },
    },
  },
}

export default config
