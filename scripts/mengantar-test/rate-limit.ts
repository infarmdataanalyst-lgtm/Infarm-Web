// scripts/mengantar-test/rate-limit.ts
// Skrip DIAGNOSTIK sekali jalan: mengukur apakah endpoint search alamat Mengantar menerapkan
// rate limit, dan di request keberapa ia mulai menolak.
//
// BUKAN bagian dari aplikasi. Tidak diimpor kode mana pun, tidak dijalankan otomatis.
//
// ── Aman dijalankan ──
// Search alamat adalah panggilan BACA: gratis, tak memotong saldo Mengantar, tak menerbitkan
// apa pun. Ia termasuk daftar "bebas dipanggil" di CLAUDE.md. Skrip ini TIDAK menyentuh
// POST /order maupun POST /time.
//
// ── Cara jalan ──
//   node --env-file=.env.local scripts/mengantar-test/rate-limit.ts
//
// Node 22.18+/24 menjalankan .ts langsung (type stripping bawaan) — tak perlu tsx/ts-node.
// `--env-file` membaca .env.local; tanpa itu, isi env-nya sendiri lewat shell.
//
// ── Catatan penting soal API key ──
// Aplikasi memanggil search alamat dengan segmen path literal `test`, BUKAN MENGANTAR_API_KEY
// (lihat src/app/api/mengantar/address/search/route.ts). Endpoint ini memang tak butuh kredensial.
// Karena itu default skrip ini juga `test` — memasukkan kunci asli ke URL hanya membuatnya
// tercetak di log dan riwayat shell tanpa manfaat apa pun. Bila benar-benar perlu menguji dengan
// kunci asli, isi MENGANTAR_ADDRESS_KEY; nilainya tetap tak pernah dicetak utuh.

// === Konfigurasi ===

const TOTAL_REQUESTS = 30
const DELAY_MS = 200

// Timeout per request. Tanpa ini, satu koneksi menggantung membuat skrip diam selamanya dan
// hasil pengukurannya tak pernah keluar.
const REQUEST_TIMEOUT_MS = 10_000

const KEYWORD = 'jakarta'

// Host default = produksi, mengikuti route aplikasi yang SENGAJA tak memakai MENGANTAR_BASE_URL:
// master data wilayah identik di kedua host, dan search alamat harus tetap hidup walau
// MENGANTAR_BASE_URL diarahkan ke sandbox.
const DEFAULT_BASE_URL = 'https://app.mengantar.com'
const DEFAULT_KEY_SEGMENT = 'test'

type Attempt = {
  index: number
  status: number // 0 = gagal sebelum dapat respons (timeout/jaringan)
  ms: number
  note: string // nama error, atau '' bila normal
}

// Menyamarkan kunci untuk dicetak: 4 karakter pertama saja.
// Segmen `test` bukan rahasia, jadi ditampilkan apa adanya.
function maskKey(key: string): string {
  if (key === DEFAULT_KEY_SEGMENT) return key
  return `${key.slice(0, 4)}…(${key.length} karakter)`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Satu panggilan, selalu mengembalikan hasil — kegagalan jaringan dicatat, bukan dilempar.
// Skrip harus menyelesaikan ke-30 percobaan supaya polanya terlihat utuh.
async function callOnce(url: string, index: number): Promise<Attempt> {
  const started = performance.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    // Body tetap dibaca sampai habis: koneksi yang tak dikuras bisa menahan slot dan
    // mengacaukan pengukuran request berikutnya.
    await res.text()
    return { index, status: res.status, ms: Math.round(performance.now() - started), note: '' }
  } catch (e) {
    // Hanya `name` yang dicatat — pesan error fetch di sebagian runtime memuat URL utuh.
    return {
      index,
      status: 0,
      ms: Math.round(performance.now() - started),
      note: e instanceof Error ? e.name : 'UnknownError',
    }
  }
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width)
}

async function main(): Promise<void> {
  const baseUrl = (process.env.MENGANTAR_ADDRESS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const keySegment = process.env.MENGANTAR_ADDRESS_KEY || DEFAULT_KEY_SEGMENT

  const url = `${baseUrl}/api/public/${encodeURIComponent(keySegment)}/address/search?keyword=${encodeURIComponent(KEYWORD)}`

  console.log('Uji rate limit — search alamat Mengantar')
  console.log(`  host     : ${baseUrl}`)
  console.log(`  key      : ${maskKey(keySegment)}`)
  console.log(`  keyword  : ${KEYWORD}`)
  console.log(`  request  : ${TOTAL_REQUESTS}× dengan jeda ${DELAY_MS}ms`)
  console.log('')
  console.log(`${pad('#', 4)}${pad('status', 8)}${padStart('ms', 6)}  catatan`)
  console.log('-'.repeat(40))

  const attempts: Attempt[] = []

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const attempt = await callOnce(url, i)
    attempts.push(attempt)

    const statusLabel = attempt.status === 0 ? 'ERR' : String(attempt.status)
    const flag = attempt.status === 429 ? 'RATE LIMIT' : attempt.note
    console.log(`${pad(i, 4)}${pad(statusLabel, 8)}${padStart(attempt.ms, 6)}  ${flag}`)

    // Jeda hanya di antara request, bukan setelah yang terakhir.
    if (i < TOTAL_REQUESTS) await sleep(DELAY_MS)
  }

  // === Ringkasan ===

  const ok = attempts.filter((a) => a.status >= 200 && a.status < 300)
  const failed = attempts.filter((a) => !(a.status >= 200 && a.status < 300))
  const limited = attempts.filter((a) => a.status === 429)
  const firstLimited = limited.length > 0 ? limited[0].index : null

  // Rata-rata dihitung dari SEMUA percobaan yang sempat mendapat respons HTTP. Percobaan yang
  // gagal di lapisan jaringan (status 0) dibuang: angkanya adalah durasi timeout, bukan waktu
  // layanan, dan memasukkannya membuat rata-rata terlihat jauh lebih buruk dari kenyataan.
  const timed = attempts.filter((a) => a.status !== 0)
  const avg = timed.length > 0 ? Math.round(timed.reduce((s, a) => s + a.ms, 0) / timed.length) : 0
  const fastest = timed.length > 0 ? Math.min(...timed.map((a) => a.ms)) : 0
  const slowest = timed.length > 0 ? Math.max(...timed.map((a) => a.ms)) : 0

  // Sebaran status, supaya kegagalan non-429 (403, 500, timeout) tak tersamar jadi satu angka.
  const byStatus = new Map<number, number>()
  for (const a of attempts) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1)

  console.log('')
  console.log('Ringkasan')
  console.log('-'.repeat(40))
  console.log(`${pad('total request', 24)}${padStart(TOTAL_REQUESTS, 8)}`)
  console.log(`${pad('sukses (2xx)', 24)}${padStart(ok.length, 8)}`)
  console.log(`${pad('gagal', 24)}${padStart(failed.length, 8)}`)
  console.log(`${pad('kena 429', 24)}${padStart(limited.length, 8)}`)
  console.log(`${pad('rata-rata (ms)', 24)}${padStart(avg, 8)}`)
  console.log(`${pad('tercepat (ms)', 24)}${padStart(fastest, 8)}`)
  console.log(`${pad('terlambat (ms)', 24)}${padStart(slowest, 8)}`)

  console.log('')
  console.log('Sebaran status')
  console.log('-'.repeat(40))
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`${pad(status === 0 ? 'ERR (jaringan)' : status, 24)}${padStart(count, 8)}`)
  }

  console.log('')
  if (firstLimited !== null) {
    console.log(`Rate limit MULAI di request ke-${firstLimited} (${TOTAL_REQUESTS} request, jeda ${DELAY_MS}ms).`)
  } else if (failed.length > 0) {
    console.log('Tidak ada 429. Ada kegagalan lain — lihat sebaran status di atas.')
  } else {
    console.log(`Tidak ada rate limit terdeteksi pada ${TOTAL_REQUESTS} request berjeda ${DELAY_MS}ms.`)
    console.log('Catatan: ini bukan bukti tak ada limit — hanya bukti limitnya di atas laju ini.')
  }
}

main().catch((e: unknown) => {
  console.error('Skrip gagal:', e instanceof Error ? e.name : e)
  process.exitCode = 1
})

// Penanda modul: kedua skrip di folder ini punya konstanta bernama sama (DELAY_MS, dll).
// Tanpa export, TypeScript memperlakukan keduanya sebagai skrip global dan namanya bertabrakan.
export {}
