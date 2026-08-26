// scripts/mengantar-test/typing-session.ts
// Skrip DIAGNOSTIK sekali jalan: mengukur dampak cache klien + debounce 300ms pada pencarian
// alamat, dengan mensimulasikan satu sesi pengisian alamat yang wajar.
//
// BUKAN bagian dari aplikasi. Tidak diimpor kode mana pun.
//
// ── Kenapa skrip terpisah dari response-time.ts ──
// response-time.ts mengukur SERVER (berapa lama Mengantar menjawab). Perubahan yang kita buat ada
// di KLIEN (cache + debounce), dan itu tak mengubah waktu respons server sedikit pun. Menjalankan
// ulang response-time.ts karena itu akan menghasilkan angka yang sama dan tak membuktikan apa pun.
// Yang berubah adalah BERAPA KALI server dipanggil dan BERAPA LAMA pembeli menunggu — dua hal
// itulah yang diukur di sini.
//
// ── Aman dijalankan ──
// Search alamat = panggilan BACA: gratis, tak memotong saldo, tak menerbitkan apa pun.
//
// ── Cara jalan ──
//   node scripts/mengantar-test/typing-session.ts

// === Simulasi sesi ===

// Kata kunci yang BENAR-BENAR ditembakkan ke API dalam satu sesi pengisian alamat.
//
// Ini bukan tiap huruf: debounce hanya melepas request saat pembeli BERHENTI mengetik. Urutan di
// bawah memodelkan jeda-jeda itu, termasuk perilaku yang paling sering terlewat saat menilai
// performa — pembeli menghapus kembali ke kata sebelumnya lalu mencoba kelurahan lain, dan di
// akhir membandingkan ulang pilihan pertamanya.
const SESSION = [
  'cengkareng', // mulai mengetik, berhenti sejenak
  'cengkareng barat', // lanjut
  'cengkareng', // hapus — ragu, mau lihat opsi lain
  'cengkareng timur', // coba kelurahan lain
  'kebayoran', // ternyata salah kecamatan, ganti
  'kebayoran lama',
  'kebayoran', // hapus lagi
  'kebayoran baru',
  'cengkareng barat', // kembali membandingkan
  'cengkareng barat', // buka ulang panel
]

// Konfigurasi SEBELUM & SESUDAH perubahan.
const BEFORE = { label: 'SEBELUM (debounce 500ms, tanpa cache)', debounceMs: 500, cache: false }
const AFTER = { label: 'SESUDAH (debounce 300ms, dengan cache)', debounceMs: 300, cache: true }

const DELAY_MS = 200
const REQUEST_TIMEOUT_MS = 10_000

const DEFAULT_BASE_URL = 'https://app.mengantar.com'
const DEFAULT_KEY_SEGMENT = 'test'

type Simulation = {
  label: string
  requests: number
  totalWaitMs: number
  avgWaitMs: number
  instantSteps: number
  // Penantian TIAP langkah sesi (0 untuk cache hit) — dasar perhitungan persentil.
  waits: number[]
  p50: number
  p95: number
}

// Persentil nearest-rank. Daftar kosong → 0.
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width)
}

// Waktu respons satu kata kunci. -1 bila gagal.
async function measure(url: string): Promise<number> {
  const started = performance.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    await res.text()
    if (!res.ok) return -1
    return Math.round(performance.now() - started)
  } catch {
    return -1
  }
}

// Menghitung total penantian pembeli untuk satu konfigurasi.
//
// Model waktunya:
//   cache MISS  → debounce + waktu respons server
//   cache HIT   → 0ms. Bukan pembulatan: komponen membaca cache saat RENDER, jadi hasilnya tampil
//                 pada ketikan itu juga — debounce pun tak sempat berjalan.
function simulate(
  config: { label: string; debounceMs: number; cache: boolean },
  responseTime: Map<string, number>,
): Simulation {
  const seen = new Set<string>()
  const waits: number[] = []
  let requests = 0
  let instantSteps = 0

  for (const keyword of SESSION) {
    const isHit = config.cache && seen.has(keyword)
    if (isHit) {
      instantSteps++
      waits.push(0)
      continue
    }
    requests++
    seen.add(keyword)
    waits.push(config.debounceMs + (responseTime.get(keyword) ?? 0))
  }

  const totalWaitMs = waits.reduce((s, v) => s + v, 0)

  return {
    label: config.label,
    requests,
    totalWaitMs,
    avgWaitMs: Math.round(totalWaitMs / SESSION.length),
    instantSteps,
    waits,
    p50: percentile(waits, 50),
    p95: percentile(waits, 95),
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.MENGANTAR_ADDRESS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const keySegment = process.env.MENGANTAR_ADDRESS_KEY || DEFAULT_KEY_SEGMENT
  const urlFor = (keyword: string) =>
    `${baseUrl}/api/public/${encodeURIComponent(keySegment)}/address/search?keyword=${encodeURIComponent(keyword)}`

  const unique = [...new Set(SESSION)]

  console.log('Uji sesi pengisian alamat — dampak cache klien + debounce')
  console.log(`  host          : ${baseUrl}`)
  console.log(`  langkah sesi  : ${SESSION.length}`)
  console.log(`  kata kunci unik: ${unique.length}`)
  console.log('')

  // Pemanasan dibuang — request pertama menanggung DNS + TCP + TLS.
  process.stdout.write('  pemanasan… ')
  console.log(`${await measure(urlFor(unique[0]))}ms (dibuang)`)
  await sleep(DELAY_MS)

  // Waktu respons diukur SEKALI per kata kunci unik, lalu dipakai kedua simulasi. Dengan begitu
  // perbedaan angka SEBELUM/SESUDAH murni berasal dari cache & debounce, bukan dari kebetulan
  // jaringan yang berbeda antar dua pengukuran.
  const responseTime = new Map<string, number>()
  let failed = 0
  process.stdout.write('  mengukur    … ')
  for (const keyword of unique) {
    const ms = await measure(urlFor(keyword))
    if (ms < 0) failed++
    responseTime.set(keyword, Math.max(ms, 0))
    await sleep(DELAY_MS)
  }
  const times = [...responseTime.values()]
  console.log(`selesai (rata-rata ${Math.round(times.reduce((s, v) => s + v, 0) / times.length)}ms)`)
  if (failed > 0) console.log(`  ⚠ ${failed} kata kunci gagal diukur — hasil di bawah kurang akurat`)

  const before = simulate(BEFORE, responseTime)
  const after = simulate(AFTER, responseTime)

  console.log('')
  console.log(`${pad('', 26)}${padStart('SEBELUM', 10)}${padStart('SESUDAH', 10)}`)
  console.log('-'.repeat(46))
  console.log(`${pad('request ke Mengantar', 26)}${padStart(before.requests, 10)}${padStart(after.requests, 10)}`)
  console.log(`${pad('langkah tanpa tunggu', 26)}${padStart(before.instantSteps, 10)}${padStart(after.instantSteps, 10)}`)
  console.log(`${pad('total tunggu (ms)', 26)}${padStart(before.totalWaitMs, 10)}${padStart(after.totalWaitMs, 10)}`)
  console.log(`${pad('rata-rata / langkah (ms)', 26)}${padStart(before.avgWaitMs, 10)}${padStart(after.avgWaitMs, 10)}`)
  console.log(`${pad('p50 penantian (ms)', 26)}${padStart(before.p50, 10)}${padStart(after.p50, 10)}`)
  console.log(`${pad('p95 penantian (ms)', 26)}${padStart(before.p95, 10)}${padStart(after.p95, 10)}`)

  const reqCut = before.requests - after.requests
  const reqPct = Math.round((reqCut / before.requests) * 100)
  const waitCut = before.totalWaitMs - after.totalWaitMs
  const waitPct = Math.round((waitCut / before.totalWaitMs) * 100)

  console.log('')
  console.log('Selisih')
  console.log('-'.repeat(46))
  console.log(`  request  : -${reqCut} (${reqPct}% lebih sedikit)`)
  console.log(`  penantian: -${waitCut}ms (${waitPct}% lebih singkat)`)
  console.log('')
  console.log(`  ${after.instantSteps} dari ${SESSION.length} langkah kini tampil SEKETIKA (0ms).`)
  console.log('')
  console.log('Catatan: waktu respons diukur sekali per kata kunci lalu dipakai kedua simulasi.')
  console.log('Angka SEBELUM sedikit optimistis — pengulangan tanpa cache tetap membayar')
  console.log('perjalanan jaringan penuh dan satu jatah rate limit, yang tak tercermin di sini.')
}

main().catch((e: unknown) => {
  console.error('Skrip gagal:', e instanceof Error ? e.name : e)
  process.exitCode = 1
})

// Penanda modul — lihat catatan yang sama di rate-limit.ts.
export {}
