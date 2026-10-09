// src/lib/pickup-schedule.ts
// Aturan penjadwalan pickup Mengantar: hari kerja, cutoff, dan tanggal pickup efektif.
// Fungsi MURNI (tanpa DB, tanpa fetch, tanpa env) supaya bisa diuji tanpa Supabase dan dipakai
// bersama oleh cron maupun jalur checkout — satu sumber aturan, bukan dua salinan yang bisa beda.
//
// SEMUA perhitungan memakai zona WIB (UTC+7), BUKAN zona server. Vercel menjalankan fungsi di UTC,
// jadi tanpa penyesuaian ini order jam 05.00 WIB akan dihitung sebagai hari sebelumnya dan cutoff
// 15.00 WIB akan diuji terhadap jam UTC (= 22.00 WIB). Polanya sama dengan dashboard-period.ts:
// geser instant sebesar offset lalu baca dengan getter UTC, sehingga yang terbaca adalah jam
// dinding WIB.

import { WIB_OFFSET_MS } from '@/lib/dashboard-period'

// Jam dinding WIB batas terakhir pesanan masih ikut pickup HARI INI.
// Lewat jam ini kurir hari itu sudah dijadwalkan/berangkat, jadi pesanan masuk antrean besok.
export const PICKUP_CUTOFF_HOUR_WIB = 15

// Jam pickup yang diminta ke Mengantar (format HH:mm). Sore, setelah gudang selesai packing.
export const PICKUP_TIME_HHMM = '17:00'

// Hari pickup: Senin(1) sampai Sabtu(6). Minggu(0) tak ada penjemputan.
const PICKUP_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6])

// === Hari libur (gudang tutup) ===
//
// Minggu adalah aturan tetap di atas; hari libur lain (Idul Fitri, cuti bersama, tutup dadakan)
// diatur ADMIN dari OMS (store_settings.pickup_holidays, lihat mock-db/settings.ts) dan dibawa ke
// fungsi-fungsi di bawah sebagai parameter. Modul ini sengaja tak membaca setting itu sendiri:
// ia tetap murni, dan cron maupun jalur booking membacanya SEKALI lalu meneruskannya — bukan tiap
// fungsi membuka koneksi database sendiri-sendiri.
//
// Bentuk simpanannya daftar tanggal YYYY-MM-DD (WIB), masing-masing boleh berlabel ("Idul Fitri")
// supaya kartu jadwal di halaman Pesanan bisa menyebut alasannya, bukan cuma "tidak ada
// penjemputan". Untuk pengecekan, daftar itu dilebur jadi Set tanggal lewat toHolidaySet().
export type PickupHoliday = { date: string; label?: string }
export type PickupHolidays = ReadonlySet<string>
export const NO_HOLIDAYS: PickupHolidays = new Set()

// Batas jumlah tanggal libur yang boleh tersimpan. Lebih dari ini hampir pasti salah input
// (mis. menempel kalender setahun), dan nextPickupDate di bawah harus tetap menemukan hari kerja
// dalam jangkauan pencariannya.
export const MAX_PICKUP_HOLIDAYS = 60
export const PICKUP_HOLIDAY_LABEL_MAX = 40

export function toHolidaySet(list: readonly PickupHoliday[]): PickupHolidays {
  return new Set(list.map((h) => h.date))
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Instant → Date yang komponen UTC-nya berisi jam dinding WIB.
function toWibClock(ms: number): Date {
  return new Date(ms + WIB_OFFSET_MS)
}

// "YYYY-MM-DD" (WIB) dari sebuah instant.
export function wibDateString(ms: number): string {
  const c = toWibClock(ms)
  return `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}-${pad2(c.getUTCDate())}`
}

// Jam dinding WIB (0–23) dari sebuah instant.
export function wibHour(ms: number): number {
  return toWibClock(ms).getUTCHours()
}

// Parse "YYYY-MM-DD" → milidetik UTC tengah malam tanggal itu. null bila format/tanggal tak valid.
// Validasi round-trip menolak tanggal mustahil (2026-02-31 yang JavaScript gulung jadi 3 Maret).
export function parsePickupDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null
  }
  return ms
}

// Apakah tanggal itu hari penjemputan: Senin–Sabtu DAN bukan hari libur yang didaftarkan admin.
// false untuk Minggu, hari libur, dan format tak valid.
export function isPickupDay(date: string, holidays: PickupHolidays = NO_HOLIDAYS): boolean {
  const ms = parsePickupDate(date)
  if (ms === null) return false
  return PICKUP_WEEKDAYS.has(new Date(ms).getUTCDay()) && !holidays.has(date)
}

// Hari pickup pertama SETELAH tanggal yang diberikan (eksklusif). Melompati Minggu & hari libur.
//
// Batas iterasi = jaring pengaman, bukan aturan bisnis: kalau daftar hari pickup kosong karena bug
// konfigurasi, fungsi ini berhenti alih-alih menggantung. Dipasang di atas MAX_PICKUP_HOLIDAYS
// supaya libur beruntun sebanyak apa pun yang masih diizinkan disimpan tetap bisa dilompati —
// batas 14 yang lama cukup untuk Minggu saja, tapi gagal untuk libur Lebaran + akhir pekan.
export function nextPickupDate(date: string, holidays: PickupHolidays = NO_HOLIDAYS): string | null {
  const ms = parsePickupDate(date)
  if (ms === null) return null
  for (let i = 1; i <= MAX_PICKUP_HOLIDAYS + 14; i++) {
    const candidate = wibDateStringFromUtcMidnight(ms + i * 86_400_000)
    if (isPickupDay(candidate, holidays)) return candidate
  }
  return null
}

// Format tanggal dari ms yang SUDAH berupa tengah malam UTC (bukan instant nyata) — tak boleh
// digeser offset lagi, itu akan memundurkannya sehari.
function wibDateStringFromUtcMidnight(ms: number): string {
  const c = new Date(ms)
  return `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}-${pad2(c.getUTCDate())}`
}

// Mengubah tanggal internal "YYYY-MM-DD" menjadi format yang diminta Mengantar: "MM-DD-YYYY".
//
// ⚠️ Mengantar memakai urutan BULAN-TANGGAL-TAHUN (gaya AS), bukan ISO dan bukan format Indonesia.
// Contoh resmi dari dokumentasi/curl: "08-19-2026" = 19 Agustus 2026. Mengirim "2026-08-19" atau
// "19-08-2026" berpotensi diterima sebagai tanggal LAIN tanpa error — slot pickup dibuat untuk hari
// yang salah dan baru terlihat saat kurir tak datang. Karena itu konversi hanya boleh lewat fungsi
// ini, dan seluruh aplikasi tetap memakai YYYY-MM-DD di dalam.
// null bila input tak valid — pemanggil JANGAN meneruskan tanggal yang tak bisa diformat.
export function toMengantarDate(date: string): string | null {
  if (parsePickupDate(date) === null) return null
  const [y, m, d] = date.split('-')
  return `${m}-${d}-${y}`
}

// Alasan sebuah tanggal pickup dipilih — dipakai untuk logging & pesan diagnostik.
export type PickupDateReason =
  | 'hari-ini' // masih sebelum cutoff dan hari ini memang hari pickup
  | 'lewat-cutoff' // sudah lewat 15:00 WIB → hari kerja berikutnya
  | 'bukan-hari-pickup' // hari ini Minggu → hari kerja berikutnya
  | 'hari-libur' // hari ini libur yang didaftarkan admin → hari kerja berikutnya

export type ResolvedPickupDate = {
  date: string // YYYY-MM-DD (WIB) tanggal pickup efektif
  reason: PickupDateReason
  today: string // tanggal WIB saat fungsi dipanggil (untuk log)
  hour: number // jam dinding WIB saat fungsi dipanggil (untuk log)
}

// Tanggal pickup efektif untuk pesanan yang masuk pada instant tertentu.
//
// Empat cabang. Cabang "bukan hari pickup" TIDAK ada di spesifikasi awal tapi wajib: pesanan
// hari Minggu jam 10.00 masih di bawah cutoff, namun Minggu tak ada penjemputan sama sekali —
// tanpa cabang ini ia akan meminta time_id untuk hari yang kurirnya tidak datang. Hari libur
// admin bekerja persis sama, hanya alasannya dibedakan supaya log & kartu jadwal bisa menyebutnya.
//
// Libur HARUS sudah terdaftar sebelum hari H: pesanan yang masuk saat libur otomatis lari ke hari
// kerja berikutnya, tapi booking yang sudah terkirim ke Mengantar sebelum libur didaftarkan tak
// bisa ditarik kembali dari sini.
export function resolvePickupDate(
  nowMs: number = Date.now(),
  holidays: PickupHolidays = NO_HOLIDAYS,
): ResolvedPickupDate {
  const today = wibDateString(nowMs)
  const hour = wibHour(nowMs)

  if (!isPickupDay(today, holidays)) {
    const reason: PickupDateReason = holidays.has(today) ? 'hari-libur' : 'bukan-hari-pickup'
    return { date: nextPickupDate(today, holidays) ?? today, reason, today, hour }
  }
  if (hour >= PICKUP_CUTOFF_HOUR_WIB) {
    return { date: nextPickupDate(today, holidays) ?? today, reason: 'lewat-cutoff', today, hour }
  }
  return { date: today, reason: 'hari-ini', today, hour }
}

// === Daftar libur: baca dari simpanan & validasi masukan admin ===

// Mengurai nilai mentah store_settings.pickup_holidays (teks JSON) menjadi daftar yang bersih.
// Toleran: entri yang rusak dilewati, bukan menggagalkan seluruh daftar — satu tanggal salah ketik
// yang lolos entah bagaimana tak boleh membuat libur lain ikut hilang. null/teks bukan JSON → [].
export function parsePickupHolidays(raw: string | null | undefined): PickupHoliday[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: PickupHoliday[] = []
  for (const entry of parsed) {
    const date =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>).date
          : undefined
    if (typeof date !== 'string' || parsePickupDate(date) === null || seen.has(date)) continue
    seen.add(date)
    const label =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).label
        : undefined
    const cleanLabel = typeof label === 'string' ? label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX) : ''
    out.push(cleanLabel ? { date, label: cleanLabel } : { date })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export type NormalizedHolidays =
  | { ok: true; holidays: PickupHoliday[]; dropped: string[] }
  | { ok: false; error: string }

// Memvalidasi daftar libur dari form admin sebelum disimpan. Ketat, berbeda dari parsePickupHolidays:
// masukan yang salah DITOLAK dengan pesan, bukan dilewati diam-diam — admin harus tahu kalau tanggal
// yang ia ketik tidak tersimpan.
//
//   - format wajib YYYY-MM-DD dan tanggalnya nyata (2027-02-30 ditolak);
//   - tanggal yang sudah lewat (sebelum `today`, WIB) dibuang & dilaporkan di `dropped`, bukan
//     ditolak: daftar yang disimpan berbulan-bulan lalu wajar masih memuat libur yang sudah lewat;
//   - Minggu diterima apa adanya (sudah libur, mendaftarkannya tak berbahaya) supaya admin bisa
//     menempel rentang "19–24 Maret" tanpa memilah harinya;
//   - duplikat dilebur, label dipotong ke PICKUP_HOLIDAY_LABEL_MAX, jumlah ≤ MAX_PICKUP_HOLIDAYS.
export function normalizePickupHolidays(input: unknown, today: string): NormalizedHolidays {
  if (!Array.isArray(input)) return { ok: false, error: 'Daftar libur harus berupa array.' }
  const byDate = new Map<string, PickupHoliday>()
  const dropped: string[] = []
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'Tiap entri libur harus berisi tanggal.' }
    }
    const { date, label } = entry as Record<string, unknown>
    if (typeof date !== 'string' || parsePickupDate(date) === null) {
      return { ok: false, error: `Tanggal tidak valid: ${String(date ?? '(kosong)')}.` }
    }
    if (label !== undefined && label !== null && typeof label !== 'string') {
      return { ok: false, error: `Keterangan untuk ${date} harus berupa teks.` }
    }
    if (date < today) {
      dropped.push(date)
      continue
    }
    const cleanLabel = typeof label === 'string' ? label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX) : ''
    byDate.set(date, cleanLabel ? { date, label: cleanLabel } : { date })
  }
  if (byDate.size > MAX_PICKUP_HOLIDAYS) {
    return {
      ok: false,
      error: `Terlalu banyak tanggal libur (maksimal ${MAX_PICKUP_HOLIDAYS}).`,
    }
  }
  const holidays = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { ok: true, holidays, dropped }
}
