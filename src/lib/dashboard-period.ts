// src/lib/dashboard-period.ts
// Periode & granularity untuk Dashboard OMS.
//
// Helper MURNI (tanpa akses DB, tanpa React) supaya dipakai bersama oleh Server Component
// (yang mengagregasi pendapatan) dan komponen client (toggle periode) tanpa duplikasi logika.
//
// SEMUA perhitungan tanggal memakai zona WIB (UTC+7), BUKAN zona server. Alasannya penting:
// server produksi (Vercel) berjalan di UTC, jadi "Hari ini" tanpa penyesuaian akan bergeser
// 7 jam — pesanan jam 05.00 WIB masih terhitung sebagai hari sebelumnya, dan breakdown per jam
// akan salah label sebanyak 7 kolom. Triknya: geser instant +7 jam, lalu baca komponennya
// dengan getter UTC (getUTCHours dst) sehingga yang terbaca adalah jam dinding WIB.

// === Konstanta ===

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Nama bulan singkat Bahasa Indonesia untuk label sumbu-X granularity 'month'.
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

// Ambang granularity untuk custom range: di atas ini per-hari jadi terlalu padat
// (92 hari ≈ 1 kuartal, masih ~92 kolom yang bisa dibaca dengan interval tick otomatis).
const CUSTOM_MAX_DAY_BUCKETS = 92

// === Tipe ===

export type PeriodPreset =
  | 'hari-ini'
  | '7-hari'
  | '30-hari'
  | 'bulan-ini'
  | 'tahun-ini'
  | 'custom'

// Granularity sumbu-X chart tren. Ditentukan otomatis dari panjang periode.
export type Granularity = 'hour' | 'day' | 'month'

export const DEFAULT_PERIOD: PeriodPreset = '30-hari'

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'hari-ini', label: 'Hari ini' },
  { value: '7-hari', label: '7 Hari' },
  { value: '30-hari', label: '30 Hari' },
  { value: 'bulan-ini', label: 'Bulan ini' },
  { value: 'tahun-ini', label: 'Tahun ini' },
  { value: 'custom', label: 'Custom' },
]

export type ResolvedPeriod = {
  preset: PeriodPreset
  // Batas bawah INKLUSIF — instant UTC dari awal hari WIB.
  fromIso: string
  // Batas atas EKSKLUSIF. Dipakai dengan .lt() supaya pesanan tepat tengah malam tidak
  // terhitung dua kali di dua periode berdampingan.
  toIso: string
  // Batas atas INKLUSIF (toIso − 1ms) — untuk pemanggil lama yang memakai .lte(),
  // mis. getBestSellingProducts di mock-db/orders.ts.
  toIsoInclusive: string
  granularity: Granularity
  // Label periode untuk judul kartu & chart, mis. "30 hari terakhir".
  label: string
  // Label periode pembanding untuk badge delta, mis. "30 hari sebelumnya".
  comparisonLabel: string
  // YYYY-MM-DD (WIB) untuk mengisi <input type="date"> di toggle custom.
  fromDate: string
  toDate: string
}

// === Konversi WIB ===

// Instant → Date yang komponen UTC-nya berisi jam dinding WIB.
function toWibClock(ms: number): Date {
  return new Date(ms + WIB_OFFSET_MS)
}

// Kebalikan toWibClock: jam dinding WIB (dalam ms) → instant UTC sebenarnya.
function fromWibClock(clockMs: number): number {
  return clockMs - WIB_OFFSET_MS
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// YYYY-MM-DD dari jam dinding WIB.
function clockToDateString(clockMs: number): string {
  const c = new Date(clockMs)
  return `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}-${pad2(c.getUTCDate())}`
}

// Mengubah instant ISO (created_at dari DB) menjadi tanggal WIB "YYYY-MM-DD".
export function toWibDateString(iso: string): string {
  return clockToDateString(toWibClock(new Date(iso).getTime()).getTime())
}

// Awal hari (00:00 WIB) dari sebuah jam dinding WIB.
function startOfWibDay(clockMs: number): number {
  const c = new Date(clockMs)
  return Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate())
}

// Parse "YYYY-MM-DD" → jam dinding WIB awal hari itu. null bila format/tanggal tidak valid.
// Validasi round-trip dipakai agar tanggal mustahil (mis. 2026-02-31, yang otomatis
// "digulung" JavaScript menjadi 3 Maret) ditolak, bukan diterima jadi tanggal lain.
function parseDateString(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const clockMs = Date.UTC(y, m - 1, d)
  return clockToDateString(clockMs) === value ? clockMs : null
}

// === Resolusi periode dari URL query params ===

// Menentukan rentang waktu + granularity dari query params dashboard (?periode=&dari=&sampai=).
//
// Nilai tak dikenal / custom range tidak valid DIABAIKAN (jatuh ke DEFAULT_PERIOD), bukan
// dijadikan error — pola sama dengan filter gudang di halaman Pesanan: bookmark atau URL lama
// harus tetap menampilkan data, bukan halaman rusak.
export function resolvePeriod(
  params: { periode?: string | null; dari?: string | null; sampai?: string | null },
  nowMs: number = Date.now(),
): ResolvedPeriod {
  const nowClock = toWibClock(nowMs).getTime()
  const todayStart = startOfWibDay(nowClock)
  // Akhir hari ini sebagai batas EKSKLUSIF: 00:00 WIB besok.
  const todayEnd = todayStart + DAY_MS
  const nowDate = new Date(todayStart)

  const requested = params.periode as PeriodPreset | undefined | null
  const preset: PeriodPreset = PERIOD_OPTIONS.some((o) => o.value === requested)
    ? (requested as PeriodPreset)
    : DEFAULT_PERIOD

  // --- Custom range ---
  if (preset === 'custom') {
    const fromClock = parseDateString(params.dari)
    // `sampai` kosong dianggap "sampai hari ini" agar range setengah-terisi tetap berguna.
    const toClockStart = parseDateString(params.sampai) ?? todayStart
    if (fromClock !== null && fromClock <= toClockStart) {
      const toClock = toClockStart + DAY_MS // inklusif tanggal akhir → +1 hari eksklusif
      const spanDays = Math.round((toClock - fromClock) / DAY_MS)
      const granularity: Granularity =
        spanDays <= 1 ? 'hour' : spanDays <= CUSTOM_MAX_DAY_BUCKETS ? 'day' : 'month'
      return buildPeriod({
        preset,
        fromClock,
        toClock,
        granularity,
        label: `${formatWibDateLong(fromClock)} – ${formatWibDateLong(toClockStart)}`,
        comparisonLabel: 'periode sebelumnya',
      })
    }
    // Range tidak valid → jatuh ke default (jangan tampilkan halaman kosong tanpa penjelasan).
  }

  switch (preset) {
    case 'hari-ini':
      return buildPeriod({
        preset,
        fromClock: todayStart,
        toClock: todayEnd,
        granularity: 'hour',
        label: 'Hari ini',
        comparisonLabel: 'kemarin',
      })
    case '7-hari':
      // 7 hari TERMASUK hari ini → mundur 6 hari dari awal hari ini.
      return buildPeriod({
        preset,
        fromClock: todayStart - 6 * DAY_MS,
        toClock: todayEnd,
        granularity: 'day',
        label: '7 hari terakhir',
        comparisonLabel: '7 hari sebelumnya',
      })
    case 'bulan-ini':
      return buildPeriod({
        preset,
        fromClock: Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1),
        toClock: todayEnd,
        granularity: 'day',
        label: 'Bulan ini',
        comparisonLabel: 'periode sebelumnya',
      })
    case 'tahun-ini':
      return buildPeriod({
        preset,
        fromClock: Date.UTC(nowDate.getUTCFullYear(), 0, 1),
        toClock: todayEnd,
        granularity: 'month',
        label: 'Tahun ini',
        comparisonLabel: 'periode sebelumnya',
      })
    default:
      return buildPeriod({
        preset: '30-hari',
        fromClock: todayStart - 29 * DAY_MS,
        toClock: todayEnd,
        granularity: 'day',
        label: '30 hari terakhir',
        comparisonLabel: '30 hari sebelumnya',
      })
  }
}

// Menyusun ResolvedPeriod dari batas jam dinding WIB (dipakai internal resolvePeriod).
function buildPeriod(input: {
  preset: PeriodPreset
  fromClock: number
  toClock: number
  granularity: Granularity
  label: string
  comparisonLabel: string
}): ResolvedPeriod {
  const fromMs = fromWibClock(input.fromClock)
  const toMs = fromWibClock(input.toClock)
  return {
    preset: input.preset,
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    toIsoInclusive: new Date(toMs - 1).toISOString(),
    granularity: input.granularity,
    label: input.label,
    comparisonLabel: input.comparisonLabel,
    fromDate: clockToDateString(input.fromClock),
    // Tanggal akhir yang DITAMPILKAN = sehari sebelum batas eksklusif.
    toDate: clockToDateString(input.toClock - DAY_MS),
  }
}

// Periode pembanding: rentang dengan panjang SAMA persis, tepat sebelum periode aktif.
// Dipakai menghitung delta pertumbuhan di kartu statistik.
export function previousPeriod(period: ResolvedPeriod): { fromIso: string; toIso: string } {
  const fromMs = new Date(period.fromIso).getTime()
  const toMs = new Date(period.toIso).getTime()
  const durationMs = toMs - fromMs
  return {
    fromIso: new Date(fromMs - durationMs).toISOString(),
    toIso: period.fromIso,
  }
}

// === Bucket sumbu-X ===

export type BucketSlot = { key: string; label: string }

// Kunci bucket sebuah instant sesuai granularity. HARUS memakai jam dinding WIB agar
// pesanan dikelompokkan ke hari/jam yang sama dengan yang dilihat admin.
export function bucketKeyOf(iso: string, granularity: Granularity): string {
  const c = toWibClock(new Date(iso).getTime())
  const y = c.getUTCFullYear()
  const m = pad2(c.getUTCMonth() + 1)
  if (granularity === 'month') return `${y}-${m}`
  const d = pad2(c.getUTCDate())
  if (granularity === 'day') return `${y}-${m}-${d}`
  return `${y}-${m}-${d}T${pad2(c.getUTCHours())}`
}

// Awal bucket berikutnya. Bulan dihitung kalender (bukan +30 hari) supaya label bulan
// tidak melenceng di bulan 28/31 hari.
function nextBucketStart(clockMs: number, granularity: Granularity): number {
  if (granularity === 'hour') return clockMs + HOUR_MS
  if (granularity === 'day') return clockMs + DAY_MS
  const c = new Date(clockMs)
  return Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1)
}

// Menormalkan awal bucket pertama (granularity 'month' butuh tanggal 1).
function alignBucketStart(clockMs: number, granularity: Granularity): number {
  if (granularity !== 'month') return clockMs
  const c = new Date(clockMs)
  return Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1)
}

function bucketLabel(clockMs: number, granularity: Granularity): string {
  const c = new Date(clockMs)
  if (granularity === 'hour') return `${pad2(c.getUTCHours())}:00`
  if (granularity === 'day') return `${pad2(c.getUTCDate())}/${pad2(c.getUTCMonth() + 1)}`
  return MONTH_SHORT[c.getUTCMonth()]
}

// Tanggal panjang WIB untuk label periode custom, mis. "1 Agu 2026".
function formatWibDateLong(clockMs: number): string {
  const c = new Date(clockMs)
  return `${c.getUTCDate()} ${MONTH_SHORT[c.getUTCMonth()]} ${c.getUTCFullYear()}`
}

// Deret bucket KOSONG sepanjang periode — dipakai sebagai kerangka chart supaya sumbu-X
// tetap kontinu (hari/jam tanpa pesanan tampil sebagai nol, bukan hilang dari sumbu).
//
// Bucket MASA DEPAN sengaja tidak dibuat: "Hari ini" pada jam 10.00 hanya menampilkan
// 00:00–10:00, karena deret nol di ujung kanan membuat tren terlihat seolah anjlok.
export function buildBuckets(
  period: ResolvedPeriod,
  nowMs: number = Date.now(),
): BucketSlot[] {
  const fromClock = alignBucketStart(
    toWibClock(new Date(period.fromIso).getTime()).getTime(),
    period.granularity,
  )
  const toClock = toWibClock(new Date(period.toIso).getTime()).getTime()
  const nowClock = toWibClock(nowMs).getTime()

  const slots: BucketSlot[] = []
  // Batas iterasi: bucket dengan awal <= sekarang (bucket yang sedang berjalan ikut tampil).
  for (
    let cursor = fromClock;
    cursor < toClock && cursor <= nowClock;
    cursor = nextBucketStart(cursor, period.granularity)
  ) {
    slots.push({
      key: bucketKeyOf(new Date(fromWibClock(cursor)).toISOString(), period.granularity),
      label: bucketLabel(cursor, period.granularity),
    })
  }
  return slots
}

// Keterangan granularity untuk subjudul chart ("Dikelompokkan per hari").
export function granularityLabel(granularity: Granularity): string {
  if (granularity === 'hour') return 'per jam'
  if (granularity === 'month') return 'per bulan'
  return 'per hari'
}
