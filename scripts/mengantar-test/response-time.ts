// scripts/mengantar-test/response-time.ts
// Skrip DIAGNOSTIK sekali jalan: mengukur waktu respons endpoint search alamat Mengantar dengan
// beragam kata kunci, lalu menilai apakah debounce 300ms cukup untuk form pencarian alamat.
//
// BUKAN bagian dari aplikasi. Tidak diimpor kode mana pun, tidak dijalankan otomatis.
//
// ── Aman dijalankan ──
// Search alamat adalah panggilan BACA: gratis, tak memotong saldo Mengantar, tak menerbitkan
// apa pun (lihat daftar "bebas dipanggil" di CLAUDE.md). Skrip ini tak menyentuh POST /order
// maupun POST /time.
//
// ── Cara jalan ──
//   node scripts/mengantar-test/response-time.ts
//
// Node 22.18+/24 menjalankan .ts langsung (type stripping bawaan) — tak perlu tsx/ts-node.
//
// ── Host & key ──
// Sama seperti scripts/mengantar-test/rate-limit.ts: default menembak app.mengantar.com dengan
// segmen path literal `test`, mengikuti route aplikasi (src/app/api/mengantar/address/search).
// Endpoint ini memang tak butuh kredensial — jangan menaruh MENGANTAR_API_KEY di sini.

// === Konfigurasi ===

// Kata kunci sengaja beragam: kota besar, kota menengah, dan nama kecamatan. Kecamatan diuji
// karena hasilnya jauh lebih sedikit daripada "jakarta" — kalau waktu respons ternyata bergantung
// pada besar hasil, perbedaannya akan terlihat di sini, bukan pada daftar yang isinya kota besar
// semua.
const KEYWORDS = [
  'jakarta',
  'bandung',
  'surabaya',
  'medan',
  'makassar',
  'semarang',
  'denpasar',
  'palembang',
  'cengkareng',
  'kebayoran',
]

// Berapa putaran seluruh daftar kata kunci dijalankan.
//
// KENAPA >1: p95 dari 10 sampel secara matematis hanyalah nilai maksimum — tak memberi informasi
// tambahan apa pun. Dengan 3 putaran = 30 sampel, p95 mulai berarti. Putaran juga memperlihatkan
// efek cache sisi Mengantar: kalau putaran kedua jauh lebih cepat, angka putaran pertama yang
// harus dipakai untuk menilai pengalaman pembeli baru.
const ROUNDS = 3

// Jeda antar request. Cukup longgar supaya pengukuran ini sendiri tak memicu throttling dan
// mengotori hasilnya.
const DELAY_MS = 200

const REQUEST_TIMEOUT_MS = 10_000

// Debounce yang sedang dinilai (angka dari pertanyaan) dan yang dipakai aplikasi sekarang
// (AddressSearchCombobox). Keduanya dibandingkan agar keputusannya berbasis selisih, bukan
// perasaan.
const DEBOUNCE_CANDIDATE_MS = 300
const DEBOUNCE_CURRENT_MS = 500

// Ambang rasa: di bawah ini interaksi terasa langsung; di atasnya mulai terasa menunggu.
// Rujukan umum riset UX (Nielsen): 100ms = instan, 1000ms = masih tak putus alur.
const FEELS_INSTANT_MS = 500
const FEELS_SLOW_MS = 1000

const DEFAULT_BASE_URL = 'https://app.mengantar.com'
const DEFAULT_KEY_SEGMENT = 'test'

type Sample = {
  keyword: string
  round: number
  ms: number
  ok: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Persentil ke-p dari daftar angka (nearest-rank). Daftar kosong → 0.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width)
}

// Satu panggilan terukur. Kegagalan dicatat, bukan dilempar — satu kata kunci bermasalah tak boleh
// menggagalkan seluruh pengukuran.
async function measure(url: string, keyword: string, round: number): Promise<Sample> {
  const started = performance.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    // Body dikuras sampai habis: waktu yang diukur harus mencakup transfer isinya, bukan berhenti
    // di header. Koneksi yang tak dihabiskan juga bisa menahan slot dan mengacaukan request
    // berikutnya.
    await res.text()
    return { keyword, round, ms: Math.round(performance.now() - started), ok: res.ok }
  } catch {
    return { keyword, round, ms: Math.round(performance.now() - started), ok: false }
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.MENGANTAR_ADDRESS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const keySegment = process.env.MENGANTAR_ADDRESS_KEY || DEFAULT_KEY_SEGMENT

  const urlFor = (keyword: string) =>
    `${baseUrl}/api/public/${encodeURIComponent(keySegment)}/address/search?keyword=${encodeURIComponent(keyword)}`

  const total = KEYWORDS.length * ROUNDS

  console.log('Uji waktu respons — search alamat Mengantar')
  console.log(`  host      : ${baseUrl}`)
  console.log(`  kata kunci: ${KEYWORDS.length} × ${ROUNDS} putaran = ${total} sampel`)
  console.log(`  jeda      : ${DELAY_MS}ms antar request`)
  console.log('')

  // Pemanasan, TIDAK dihitung. Request pertama ke host baru menanggung DNS + TCP + TLS handshake
  // (terukur ~2× lebih lambat di uji rate limit). Memasukkannya akan menaikkan rata-rata dan max
  // untuk biaya yang hanya dibayar sekali per koneksi, bukan tiap ketikan pembeli.
  process.stdout.write('  pemanasan… ')
  const warmup = await measure(urlFor(KEYWORDS[0]), KEYWORDS[0], 0)
  console.log(`${warmup.ms}ms (dibuang)`)
  await sleep(DELAY_MS)

  const samples: Sample[] = []
  for (let round = 1; round <= ROUNDS; round++) {
    process.stdout.write(`  putaran ${round}/${ROUNDS}… `)
    for (const keyword of KEYWORDS) {
      samples.push(await measure(urlFor(keyword), keyword, round))
      await sleep(DELAY_MS)
    }
    const roundMs = samples.filter((s) => s.round === round).map((s) => s.ms)
    console.log(`rata-rata ${avg(roundMs)}ms`)
  }

  // === Ringkasan ===

  const okSamples = samples.filter((s) => s.ok)
  const failed = samples.length - okSamples.length
  const times = okSamples.map((s) => s.ms)
  const sorted = [...times].sort((a, b) => a - b)

  const mean = avg(times)
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 0
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)

  console.log('')
  console.log('Waktu respons (ms)')
  console.log('-'.repeat(44))
  console.log(`${pad('sampel terpakai', 26)}${padStart(okSamples.length, 8)}`)
  if (failed > 0) console.log(`${pad('gagal (dibuang)', 26)}${padStart(failed, 8)}`)
  console.log(`${pad('rata-rata', 26)}${padStart(mean, 8)}`)
  console.log(`${pad('min', 26)}${padStart(min, 8)}`)
  console.log(`${pad('median (p50)', 26)}${padStart(p50, 8)}`)
  console.log(`${pad('p95', 26)}${padStart(p95, 8)}`)
  console.log(`${pad('max', 26)}${padStart(max, 8)}`)

  // Kata kunci terlambat — untuk memeriksa apakah besar hasil pencarian berpengaruh.
  const perKeyword = KEYWORDS.map((keyword) => ({
    keyword,
    ms: avg(okSamples.filter((s) => s.keyword === keyword).map((s) => s.ms)),
  })).sort((a, b) => b.ms - a.ms)

  console.log('')
  console.log('Kata kunci terlambat (rata-rata)')
  console.log('-'.repeat(44))
  for (const row of perKeyword.slice(0, 3)) {
    console.log(`${pad(row.keyword, 26)}${padStart(row.ms, 8)}`)
  }

  // === Penilaian debounce ===
  //
  // PENTING: debounce TIDAK mempercepat maupun memperlambat server. Ia menunda KAPAN request
  // dikirim setelah pembeli berhenti mengetik. Jadi "300ms aman kalau respons di bawah 300ms"
  // bukan hubungan yang benar — keduanya sumbu berbeda.
  //
  // Yang benar-benar dirasakan pembeli = debounce + waktu respons: jeda dari ketikan terakhir
  // sampai daftar saran muncul. Itulah yang dinilai di bawah.
  const perceivedCandidate = DEBOUNCE_CANDIDATE_MS + p95
  const perceivedCurrent = DEBOUNCE_CURRENT_MS + p95

  console.log('')
  console.log('Jeda yang dirasakan pembeli (debounce + p95)')
  console.log('-'.repeat(44))
  console.log(`${pad(`debounce ${DEBOUNCE_CANDIDATE_MS}ms`, 26)}${padStart(perceivedCandidate, 8)}`)
  console.log(`${pad(`debounce ${DEBOUNCE_CURRENT_MS}ms (sekarang)`, 26)}${padStart(perceivedCurrent, 8)}`)

  console.log('')
  console.log('Kesimpulan')
  console.log('-'.repeat(44))

  if (okSamples.length === 0) {
    console.log('Tak ada sampel berhasil — tak ada yang bisa disimpulkan. Periksa koneksi/host.')
    return
  }

  if (perceivedCandidate <= FEELS_INSTANT_MS) {
    console.log(`Debounce ${DEBOUNCE_CANDIDATE_MS}ms AMAN.`)
    console.log(`  Jeda terburuk (p95) ${perceivedCandidate}ms, masih di bawah ambang ${FEELS_INSTANT_MS}ms`)
    console.log('  yang terasa "langsung" bagi pengguna.')
  } else if (perceivedCandidate <= FEELS_SLOW_MS) {
    console.log(`Debounce ${DEBOUNCE_CANDIDATE_MS}ms MASIH LAYAK, tapi tak lagi terasa instan.`)
    console.log(`  Jeda terburuk (p95) ${perceivedCandidate}ms — di antara ${FEELS_INSTANT_MS}ms dan ${FEELS_SLOW_MS}ms.`)
  } else {
    console.log(`Debounce ${DEBOUNCE_CANDIDATE_MS}ms TERLALU LAMBAT digabung waktu respons ini.`)
    console.log(`  Jeda terburuk (p95) ${perceivedCandidate}ms melewati ambang ${FEELS_SLOW_MS}ms.`)
    console.log('  Percepat sumbernya (cache/prefetch), bukan menaikkan debounce.')
  }

  // Menurunkan debounce = lebih banyak request per pencarian. Itu urusan rate limit, bukan
  // urusan kecepatan — jadi disebut terpisah supaya keputusannya tak diambil setengah.
  const saved = perceivedCurrent - perceivedCandidate
  console.log('')
  console.log(`Turun dari ${DEBOUNCE_CURRENT_MS}ms ke ${DEBOUNCE_CANDIDATE_MS}ms memangkas ${saved}ms jeda,`)
  console.log(`tapi menaikkan jumlah request per pencarian (~${(DEBOUNCE_CURRENT_MS / DEBOUNCE_CANDIDATE_MS).toFixed(1)}× lebih sering saat mengetik).`)
  console.log('Timbang bersama RATE_LIMITS.MENGANTAR_IP di src/lib/rate-limit.ts.')
}

main().catch((e: unknown) => {
  console.error('Skrip gagal:', e instanceof Error ? e.name : e)
  process.exitCode = 1
})

// Penanda modul — lihat catatan yang sama di rate-limit.ts.
export {}
