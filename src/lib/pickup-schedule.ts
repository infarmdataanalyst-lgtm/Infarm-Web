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
// Disimpan sebagai Set agar penambahan hari libur nasional nanti tak perlu mengubah logika.
const PICKUP_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6])

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

// Apakah tanggal itu hari penjemputan (Senin–Sabtu). false untuk Minggu & format tak valid.
export function isPickupDay(date: string): boolean {
  const ms = parsePickupDate(date)
  if (ms === null) return false
  return PICKUP_WEEKDAYS.has(new Date(ms).getUTCDay())
}

// Hari pickup pertama SETELAH tanggal yang diberikan (eksklusif). Melompati Minggu.
// Batas 14 iterasi = jaring pengaman, bukan aturan bisnis: kalau suatu hari daftar hari pickup
// dikosongkan karena bug konfigurasi, fungsi ini berhenti alih-alih menggantung selamanya.
export function nextPickupDate(date: string): string | null {
  const ms = parsePickupDate(date)
  if (ms === null) return null
  for (let i = 1; i <= 14; i++) {
    const candidate = ms + i * 86_400_000
    if (PICKUP_WEEKDAYS.has(new Date(candidate).getUTCDay())) {
      return wibDateStringFromUtcMidnight(candidate)
    }
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

export type ResolvedPickupDate = {
  date: string // YYYY-MM-DD (WIB) tanggal pickup efektif
  reason: PickupDateReason
  today: string // tanggal WIB saat fungsi dipanggil (untuk log)
  hour: number // jam dinding WIB saat fungsi dipanggil (untuk log)
}

// Tanggal pickup efektif untuk pesanan yang masuk pada instant tertentu.
//
// Tiga cabang, dan cabang "bukan hari pickup" TIDAK ada di spesifikasi awal tapi wajib: pesanan
// hari Minggu jam 10.00 masih di bawah cutoff, namun Minggu tak ada penjemputan sama sekali —
// tanpa cabang ini ia akan meminta time_id untuk hari yang kurirnya tidak datang.
export function resolvePickupDate(nowMs: number = Date.now()): ResolvedPickupDate {
  const today = wibDateString(nowMs)
  const hour = wibHour(nowMs)

  if (!isPickupDay(today)) {
    return { date: nextPickupDate(today) ?? today, reason: 'bukan-hari-pickup', today, hour }
  }
  if (hour >= PICKUP_CUTOFF_HOUR_WIB) {
    return { date: nextPickupDate(today) ?? today, reason: 'lewat-cutoff', today, hour }
  }
  return { date: today, reason: 'hari-ini', today, hour }
}
