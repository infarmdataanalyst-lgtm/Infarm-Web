// src/lib/speed-insights-filter.ts
// Penyaring event Vercel Speed Insights SEBELUM dikirim dari browser pembeli. Murni — tanpa I/O,
// tanpa React — supaya bisa diuji di Vitest dan dipasang sebagai `beforeSend` dari komponen client.
//
// ── Dua tugasnya ──
//   1. HEMAT EVENT. Paket gratis hanya 10.000 event per 30 hari untuk satu tim, dan bila terlampaui
//      pengumpulan dijeda ≥14 hari. Halaman yang bukan pengalaman belanja (OMS, maintenance, API,
//      halaman dev) dibuang di sini — `null` berarti event tidak dikirim sama sekali.
//   2. TANPA DATA PRIBADI. URL halaman pesanan membawa pengenal pembeli: nomor invoice, email, nomor
//      telepon, dan token pembatalan — hari ini di QUERY STRING (`/track?order=INV-…`,
//      `/order-cancellation?id=&token=`, `/checkout/success?invoice=`), jadi query & hash dibuang
//      seluruhnya. Segmen PATH yang berbentuk pengenal juga disamarkan menjadi `[id]`, agar bila
//      suatu hari rute berubah menjadi `/track/INV-…`, dashboard Vercel tetap tidak menerima nomor
//      pesanan orang.
//
// Bentuk event mengikuti tipe `Event` di node_modules/@vercel/speed-insights/dist/next/index.d.ts
// (versi 1.0.4): `{ type: 'vital', url: string }`. Tipe itu tidak diekspor paketnya, jadi ditulis
// ulang di sini secara struktural — `beforeSend` menerima fungsi ini karena bentuknya cocok.

export type SpeedInsightsEvent = {
  type: 'vital'
  url: string
}

// Placeholder pengganti segmen path yang berisi pengenal.
export const ID_PLACEHOLDER = '[id]'

// === Path yang TIDAK pernah dikirim ===
// Dicocokkan sebagai awalan segmen (`/oms` dan `/oms/...`, bukan `/omsx`). Sama dengan daftar
// pengecualian GoogleAnalyticsGate, ditambah /api (tak punya halaman) dan /dev (pratinjau email).
export const SPEED_INSIGHTS_EXCLUDED_PREFIXES = ['/oms', '/maintenance', '/api', '/dev'] as const

// === Rute yang membawa pengenal pembeli / pesanan ===
// Segmen apa pun setelah awalan ini dianggap pengenal, KECUALI anak statis yang memang ada di
// src/app (mis. /review/submitted). Awalan lebih panjang ditulis lebih dulu agar /track-order
// tidak tertangkap /track.
const SENSITIVE_ROUTES: ReadonlyArray<{ prefix: string; staticChildren?: readonly string[] }> = [
  { prefix: '/checkout/success' },
  { prefix: '/order-cancellation' },
  { prefix: '/cancel-order' },
  { prefix: '/track-order' },
  { prefix: '/track' },
  { prefix: '/review', staticChildren: ['submitted'] },
  { prefix: '/pesanan-saya' },
]

// `pathname` tepat sama dengan `prefix`, atau berada di bawahnya.
function diBawahAwalan(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

// Path yang tidak boleh menghasilkan event sama sekali (OMS, maintenance, API, dev).
export function isSpeedInsightsExcludedPath(pathname: string): boolean {
  return SPEED_INSIGHTS_EXCLUDED_PREFIXES.some((prefix) => diBawahAwalan(pathname, prefix))
}

// Segmen yang berbentuk pengenal pribadi, di rute MANA PUN:
//   - email (mengandung @, termasuk yang ter-encode %40)
//   - 8+ digit berurutan: nomor telepon, atau tanggal di nomor invoice INV-YYYYMMDD-XXXXXXXX
//   - awalan INV- (nomor invoice tanpa digit tanggal pun tetap disamarkan)
//   - token pembatalan `kedaluwarsa.nonce.tandatangan` (lihat src/lib/order-token.ts)
function tampakSepertiPengenal(segment: string): boolean {
  let s = segment
  try {
    s = decodeURIComponent(segment)
  } catch {
    // Encoding rusak — periksa apa adanya
  }
  if (s.includes('@')) return true
  if (/\d{8,}/.test(s)) return true
  if (/^INV-/i.test(s)) return true
  if (/^[0-9a-z]+\.[0-9a-f]{8,}\.[0-9a-f]{8,}$/i.test(s)) return true
  return false
}

// Menyamarkan segmen pengenal pada sebuah pathname. Mengembalikan null bila path dikecualikan.
export function sanitizeSpeedInsightsPath(pathname: string): string | null {
  if (isSpeedInsightsExcludedPath(pathname)) return null

  const segments = pathname.split('/').filter(Boolean)
  const rute = SENSITIVE_ROUTES.find((r) => diBawahAwalan(pathname, r.prefix))
  const jumlahSegmenAwalan = rute ? rute.prefix.split('/').filter(Boolean).length : 0

  const hasil = segments.map((segment, i) => {
    if (rute && i >= jumlahSegmenAwalan) {
      // Anak statis yang memang ada di src/app tetap ditampilkan, selebihnya pengenal.
      const anakStatis = i === jumlahSegmenAwalan && rute.staticChildren?.includes(segment)
      if (!anakStatis) return ID_PLACEHOLDER
    }
    return tampakSepertiPengenal(segment) ? ID_PLACEHOLDER : segment
  })

  return `/${hasil.join('/')}`
}

// Apakah URL ditulis absolut (ada skema), bukan path relatif.
const POLA_URL_ABSOLUT = /^[a-z][a-z0-9+.-]*:\/\//i

// `beforeSend` Speed Insights: null = jangan kirim; selain itu event dengan URL yang sudah bersih
// (tanpa query, tanpa hash, segmen pengenal diganti `[id]`). URL yang tak bisa diurai juga
// dibuang — lebih baik kehilangan satu event daripada meneruskan sesuatu yang tak dipahami.
export function filterSpeedInsightsEvent(event: SpeedInsightsEvent): SpeedInsightsEvent | null {
  let parsed: URL
  try {
    // Basis hanya dipakai bila event.url relatif; untuk URL absolut diabaikan.
    parsed = new URL(event.url, 'http://localhost')
  } catch {
    return null
  }

  const path = sanitizeSpeedInsightsPath(parsed.pathname)
  if (path === null) return null

  const absolut = POLA_URL_ABSOLUT.test(event.url)
  return { ...event, url: absolut ? `${parsed.origin}${path}` : path }
}
