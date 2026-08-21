// src/lib/xendit/config.ts
// Konfigurasi terpusat API Xendit. SERVER ONLY — memegang XENDIT_SECRET_KEY.
//
// ⚠️ JANGAN pernah diimpor dari komponen 'use client', dan JANGAN pernah memberi env ini prefix
// NEXT_PUBLIC_. Secret key Xendit bisa membuat invoice, menarik dana, dan membaca transaksi;
// satu import dari client component menempelkannya ke bundel browser untuk selamanya.
//
// Autentikasi Xendit = HTTP Basic dengan secret key sebagai USERNAME dan password KOSONG.
// Jadi nilainya `base64("{SECRET_KEY}:")` — tanda titik dua wajib ada meski tak diikuti apa pun.

// Base URL API Xendit. Sama untuk test key maupun live key — yang membedakan lingkungan adalah
// KUNCINYA, bukan host-nya (berbeda dari Mengantar yang punya host sandbox terpisah).
export const XENDIT_BASE_URL = 'https://api.xendit.co'

// Path pembuatan Payment Request (Payments API v3).
//
// ⚠️ BELUM DIVERIFIKASI terhadap API sungguhan — belum ada satu pun panggilan Xendit yang pernah
// dijalankan dari project ini. Sebagian dokumentasi Xendit memakai `/v3/payment_requests`.
// Dikumpulkan sebagai konstanta di sini supaya koreksinya satu baris, bukan berburu ke seluruh kode.
export const XENDIT_PAYMENT_REQUEST_PATH = '/payment_requests'

// === Kunci & lingkungan ===

// Secret key Xendit membawa penanda lingkungan di prefiksnya:
//   xnd_development_... / xnd_public_development_...  → TEST, tak menyentuh uang sungguhan
//   xnd_production_...                               → LIVE, uang sungguhan
const TEST_KEY_PATTERN = /^xnd_(public_)?development/i

export type XenditCredentials =
  | { ok: true; authHeader: string; live: boolean }
  | { ok: false; reason: 'not-configured' | 'blocked-environment'; detail: string }

// true bila kunci ini kunci LIVE (uang sungguhan).
// Kunci tak dikenal formatnya → dianggap LIVE. Menolak-dengan-aman: memperlakukan kunci asing
// sebagai test akan membuat penjaga di bawah diam tepat saat ia paling dibutuhkan.
export function isLiveKey(secretKey: string): boolean {
  // HANYA prefix development yang dianggap TEST; apa pun selainnya (termasuk `xnd_production` dan
  // format yang tak dikenal) dianggap LIVE.
  return !TEST_KEY_PATTERN.test(secretKey.trim())
}

// true HANYA di deployment produksi sungguhan.
//
// Sama seperti penjaga Mengantar di lib/mengantar-host.ts: `NODE_ENV === 'production'` sendirian
// TIDAK cukup karena `next build`/`next start` lokal dan SELURUH preview deployment Vercel juga
// ber-NODE_ENV production, sementara preview biasanya mewarisi env produksi.
function isProductionDeployment(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  const vercelEnv = process.env.VERCEL_ENV
  return !vercelEnv || vercelEnv === 'production'
}

// Header Basic Auth untuk API Xendit, atau penolakan beserta alasannya.
//
// SETIAP panggilan ke Xendit WAJIB lewat fungsi ini dan berhenti bila `ok === false`. Jangan
// pernah membaca XENDIT_SECRET_KEY langsung di tempat lain — itu memutar balik penjaga lingkungan
// di bawah.
//
// PENJAGA LINGKUNGAN: kunci LIVE hanya boleh dipakai dari deployment produksi. Aturannya sama
// dengan penjaga Mengantar, dan alasannya sama — lihat CLAUDE.md → "Panggilan API Berbayar".
// Sengaja tanpa jalan pintas: tuas "izinkan sekali ini" selalu berakhir menyala di tempat salah.
export function xenditCredentials(): XenditCredentials {
  const secretKey = process.env.XENDIT_SECRET_KEY?.trim()
  if (!secretKey) {
    return {
      ok: false,
      reason: 'not-configured',
      detail: 'XENDIT_SECRET_KEY belum di-set di environment',
    }
  }

  const live = isLiveKey(secretKey)
  if (live && !isProductionDeployment()) {
    return {
      ok: false,
      reason: 'blocked-environment',
      detail:
        'XENDIT_SECRET_KEY adalah kunci LIVE (uang sungguhan), tapi ini bukan deployment produksi. ' +
        'Panggilan diblokir. Pakai kunci test (xnd_development_...) untuk pengembangan.',
    }
  }

  // base64("{key}:") — password Basic Auth sengaja kosong, ini memang kontrak Xendit.
  return {
    ok: true,
    authHeader: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    live,
  }
}

// URL penuh sebuah path API Xendit.
export function xenditUrl(path: string): string {
  return `${XENDIT_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
