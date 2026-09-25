// src/lib/date-range.ts
// Helper MURNI untuk kalender rentang tanggal OMS (dipakai DateRangePicker).
//
// Tanpa React, tanpa akses DB, tanpa library tanggal — supaya bisa dipanggil dari komponen client
// maupun server, dan supaya tak ada dependency baru hanya demi menyusun 42 kotak tanggal.
//
// ── SEMUA tanggal di sini adalah tanggal WIB berbentuk "YYYY-MM-DD" ──
// Alasannya sama dengan lib/dashboard-period.ts: server produksi berjalan di UTC, jadi menghitung
// "hari ini" dengan `new Date()` apa adanya akan meleset 7 jam — pesanan jam 05.00 WIB terbaca
// sebagai hari sebelumnya. Triknya pun sama: geser instant +7 jam, lalu baca dengan getter UTC
// sehingga yang terbaca adalah jam dinding WIB.
//
// Yang TIDAK ditangani di sini: jam, menit, dan rentang antar-zona. Filter OMS bekerja pada
// satuan HARI, dan menyimpan jam hanya akan membuat batas rentang jadi ambigu.

import { WIB_OFFSET_MS } from '@/lib/dashboard-period'

// Nama hari & bulan Bahasa Indonesia. Sengaja ditulis tangan, bukan lewat Intl: Intl mengikuti
// locale runtime, dan label kalender tak boleh berubah hanya karena server disetel berbeda.
export const DAY_INITIALS = ['M', 'S', 'S', 'R', 'K', 'J', 'S'] as const
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const
export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
] as const

const DAY_MS = 24 * 60 * 60 * 1000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Tanggal hari ini menurut jam dinding WIB.
export function todayWib(nowMs: number = Date.now()): string {
  const c = new Date(nowMs + WIB_OFFSET_MS)
  return `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}-${pad2(c.getUTCDate())}`
}

// Parse "YYYY-MM-DD" → milidetik awal hari (UTC-based clock). null bila format/tanggalnya mustahil.
//
// Round-trip-nya diperiksa agar tanggal seperti 2026-02-31 DITOLAK, bukan diam-diam digulung
// JavaScript menjadi 3 Maret — pola yang sama sudah dipakai resolvePeriod().
export function parseDate(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const c = new Date(ms)
  const ok = c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d
  return ok ? ms : null
}

// Kebalikan parseDate.
export function toDateString(ms: number): string {
  const c = new Date(ms)
  return `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}-${pad2(c.getUTCDate())}`
}

// Geser tanggal sejumlah hari. Dipakai preset "7 hari terakhir" dan navigasi kalender.
export function addDays(value: string, days: number): string {
  const ms = parseDate(value)
  if (ms === null) return value
  return toDateString(ms + days * DAY_MS)
}

// Perbandingan dua tanggal cukup lewat string: format YYYY-MM-DD berurut secara leksikografis.
// Ditulis sebagai fungsi agar maksudnya terbaca di tempat pemakaian.
export function isBefore(a: string, b: string): boolean {
  return a < b
}

// Apakah `value` berada di dalam rentang [from, to] (inklusif di kedua ujung).
export function isWithin(value: string, from: string, to: string): boolean {
  return value >= from && value <= to
}

// === Label ===

// Label ringkas sebuah rentang untuk tombol pemicu kalender.
//
//   sama persis        → "12 Agu 2026"
//   satu bulan & tahun → "12 – 20 Agu 2026"
//   beda bulan         → "28 Agu – 3 Sep 2026"
//   beda tahun         → "28 Des 2025 – 3 Jan 2026"
//
// Tahun hanya ditulis sekali bila keduanya sama — di layar filter yang sempit, "2026" dua kali
// hanya memakan tempat tanpa memberi tahu apa pun.
export function formatRangeLabel(from: string, to: string): string {
  const a = parseDate(from)
  const b = parseDate(to)
  if (a === null && b === null) return ''
  if (a === null || b === null) return formatSingleDate((from || to) as string)

  const ca = new Date(a)
  const cb = new Date(b)
  const sameYear = ca.getUTCFullYear() === cb.getUTCFullYear()
  const sameMonth = sameYear && ca.getUTCMonth() === cb.getUTCMonth()

  if (from === to) return formatSingleDate(from)
  if (sameMonth) {
    return `${ca.getUTCDate()} – ${cb.getUTCDate()} ${MONTH_SHORT[cb.getUTCMonth()]} ${cb.getUTCFullYear()}`
  }
  if (sameYear) {
    return (
      `${ca.getUTCDate()} ${MONTH_SHORT[ca.getUTCMonth()]} – ` +
      `${cb.getUTCDate()} ${MONTH_SHORT[cb.getUTCMonth()]} ${cb.getUTCFullYear()}`
    )
  }
  return `${formatSingleDate(from)} – ${formatSingleDate(to)}`
}

// "12 Agu 2026". Mengembalikan string kosong bila tanggalnya tak valid.
export function formatSingleDate(value: string): string {
  const ms = parseDate(value)
  if (ms === null) return ''
  const c = new Date(ms)
  return `${c.getUTCDate()} ${MONTH_SHORT[c.getUTCMonth()]} ${c.getUTCFullYear()}`
}

// "Agustus 2026" — judul di kepala kalender.
export function formatMonthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`
}

// === Susunan kotak kalender ===

export type CalendarCell = {
  date: string // YYYY-MM-DD
  day: number // tanggal dalam bulan (1–31)
  inMonth: boolean // false = tanggal "titipan" dari bulan sebelum/sesudah
}

// Matriks 6 baris × 7 kolom untuk satu bulan, selalu dimulai hari Minggu.
//
// Jumlah barisnya SENGAJA tetap 6 walau bulannya cuma butuh 5: tinggi kalender jadi konstan,
// sehingga dropdown tidak "melompat" saat admin berpindah bulan.
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const firstDayMs = Date.UTC(year, month, 1)
  const offset = new Date(firstDayMs).getUTCDay() // 0 = Minggu
  const start = firstDayMs - offset * DAY_MS

  const weeks: CalendarCell[][] = []
  for (let w = 0; w < 6; w++) {
    const week: CalendarCell[] = []
    for (let d = 0; d < 7; d++) {
      const ms = start + (w * 7 + d) * DAY_MS
      const c = new Date(ms)
      week.push({
        date: toDateString(ms),
        day: c.getUTCDate(),
        inMonth: c.getUTCMonth() === month && c.getUTCFullYear() === year,
      })
    }
    weeks.push(week)
  }
  return weeks
}

// Bulan yang ditampilkan saat kalender pertama kali dibuka: bulan tanggal mulai bila ada,
// selain itu bulan berjalan.
export function initialMonth(from: string, fallbackToday: string): { year: number; month: number } {
  const ms = parseDate(from) ?? parseDate(fallbackToday) ?? Date.now()
  const c = new Date(ms)
  return { year: c.getUTCFullYear(), month: c.getUTCMonth() }
}

// Geser bulan yang sedang tampil.
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

// === Pintasan rentang ===

export type RangePreset = {
  id: string
  label: string
  // `today` diserahkan pemanggil (bukan dihitung ulang di sini) supaya seluruh preset dalam satu
  // kalender memakai acuan "hari ini" yang sama persis.
  resolve: (today: string) => { from: string; to: string }
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'hari-ini', label: 'Hari ini', resolve: (t) => ({ from: t, to: t }) },
  { id: '7-hari', label: '7 hari terakhir', resolve: (t) => ({ from: addDays(t, -6), to: t }) },
  { id: '30-hari', label: '30 hari terakhir', resolve: (t) => ({ from: addDays(t, -29), to: t }) },
  {
    id: 'bulan-ini',
    label: 'Bulan ini',
    resolve: (t) => ({ from: `${t.slice(0, 7)}-01`, to: t }),
  },
]

// Id preset yang PERSIS cocok dengan rentang aktif, atau null bila rentangnya kustom.
// Dipakai menandai pintasan mana yang sedang berlaku, supaya admin tak menebak-nebak.
export function matchingPreset(from: string, to: string, today: string): string | null {
  if (!from || !to) return null
  for (const p of RANGE_PRESETS) {
    const r = p.resolve(today)
    if (r.from === from && r.to === to) return p.id
  }
  return null
}
