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

// Jam BAWAAN — dipakai bila admin belum pernah mengatur tab "Jam Penjemputan" di Pengaturan OMS
// (store_settings.pickup_schedule). Sejak 2026-10-13 keduanya bisa diubah dari OMS, termasuk per
// tanggal; nilai berlaku untuk suatu hari dibaca lewat pickupHoursFor(), bukan konstanta ini.
//
// Cutoff = jam dinding WIB batas terakhir pesanan masih ikut pickup HARI ITU. Lewat jam ini kurir
// hari itu sudah dijadwalkan/berangkat, jadi pesanan masuk antrean hari kerja berikutnya.
export const PICKUP_CUTOFF_HOUR_WIB = 15

// Jam pickup bawaan yang diminta ke Mengantar. Sore, setelah gudang selesai packing.
export const PICKUP_HOUR_WIB = 17
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
  | 'lewat-cutoff' // sudah lewat cutoff hari ini (bawaan 15:00 WIB) → hari kerja berikutnya
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
//
// `schedule` = jam jemput & cutoff dari OMS. Yang diuji adalah cutoff HARI INI: bila hari ini punya
// jam khusus (mis. jemput 13.00, cutoff 11.00), pesanan pukul 12.00 sudah ikut hari kerja berikutnya.
//
// `courier` = kode ekspedisi pesanan ('JT', 'spx'): cutoff tiap ekspedisi bisa berbeda, jadi pesanan
// SPX pukul 12.00 bisa sudah ikut besok sementara pesanan J&T pada jam yang sama masih ikut hari ini.
export function resolvePickupDate(
  nowMs: number = Date.now(),
  holidays: PickupHolidays = NO_HOLIDAYS,
  schedule: PickupSchedule = DEFAULT_PICKUP_SCHEDULE,
  courier?: string | null,
): ResolvedPickupDate {
  const today = wibDateString(nowMs)
  const hour = wibHour(nowMs)

  if (!isPickupDay(today, holidays)) {
    const reason: PickupDateReason = holidays.has(today) ? 'hari-libur' : 'bukan-hari-pickup'
    return { date: nextPickupDate(today, holidays) ?? today, reason, today, hour }
  }
  if (hour >= pickupHoursFor(today, schedule, courier).cutoffHour) {
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

// === Jam penjemputan & cutoff (diatur admin di OMS → Pengaturan → Jam Penjemputan) ===
//
// Dua lapis, persis pola hari libur:
//   - `default`   — jam rutin setiap hari pickup (mis. jemput 17.00, cutoff 15.00);
//   - `overrides` — jam KHUSUS untuk tanggal tertentu (kurir datang lebih awal karena acara gudang,
//                   atau lebih sore karena stok baru tiba).
// Disimpan sebagai satu JSON di store_settings.pickup_schedule; dibaca sekali oleh cron, booking
// kurir, dan kartu jadwal, lalu diteruskan ke fungsi-fungsi murni di bawah.
//
// ── Kenapa jam bulat, dan kenapa 09–18 ──
// Mengantar hanya menerima jam penjemputan 9:00, 10:00, …, 18:00 (dokumentasi POST /time). Jam di
// luar daftar itu akan ditolak saat slot dibuat — tepat di jalur bayar pembeli — jadi daftar yang
// sama dipakai sebagai satu-satunya pilihan di form.
//
// ── Kenapa cutoff minimal 2 jam sebelum jemput ──
// Mengantar menolak slot yang kurang dari 90 menit dari sekarang ("invalid pickup time"). Pesanan
// terakhir yang masih ikut hari itu lunas pada cutoff − 1 menit, dan saat itulah booking-nya
// dikirim. Dengan jarak 2 jam, booking paling akhir masih 2 jam 1 menit sebelum jemput; dengan
// jarak 1 jam hanya 61 menit dan pesanan terakhir hari itu pasti gagal dibooking.
//
// ── Per ekspedisi (sejak 2026-10-14) ──
// Tiap aturan bisa berlaku untuk SEMUA ekspedisi atau untuk SATU ekspedisi (kode API: 'JT', 'spx').
// Ekspedisi berbeda punya jam operasional berbeda — mis. SPX hanya menjemput 14.00–22.00 menurut
// pusat bantuan Mengantar — jadi admin perlu mengatur jam J&T dan SPX terpisah. Urutan prioritas
// untuk satu tanggal & satu ekspedisi, dari yang paling spesifik:
//   1. jam khusus tanggal itu untuk ekspedisi itu
//   2. jam khusus tanggal itu untuk semua ekspedisi
//   3. jam rutin ekspedisi itu (`couriers[kode]`)
//   4. jam rutin semua ekspedisi (`default`)
// Konsekuensinya satu tanggal bisa butuh beberapa slot Mengantar (satu per jam jemput), dan tabel
// mengantar_daily_pickup menyimpan jam slotnya sejak migration 20261014120000.

export type PickupHours = { pickupHour: number; cutoffHour: number }
// `courier` kosong = berlaku untuk semua ekspedisi.
export type PickupOverride = PickupHours & { date: string; label?: string; courier?: string }
export type PickupSchedule = {
  default: PickupHours
  couriers?: Record<string, PickupHours>
  overrides: PickupOverride[]
}

export const DEFAULT_PICKUP_HOURS: PickupHours = {
  pickupHour: PICKUP_HOUR_WIB,
  cutoffHour: PICKUP_CUTOFF_HOUR_WIB,
}
export const DEFAULT_PICKUP_SCHEDULE: PickupSchedule = {
  default: DEFAULT_PICKUP_HOURS,
  overrides: [],
}

// Jam penjemputan yang diterima Mengantar (POST /time).
export const MENGANTAR_PICKUP_HOURS: readonly number[] = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
export const MIN_CUTOFF_GAP_HOURS = 2
// Cutoff lebih pagi dari ini hampir pasti salah pilih: seluruh pesanan hari itu jadi ikut besok.
export const MIN_CUTOFF_HOUR = 6
export const MAX_PICKUP_OVERRIDES = 60
// Artikel bantuan Mengantar "Layanan SPX di Mengantar": jadwal pickup SPX hanya 14.00–22.00 WIB.
// Jam jemput lebih pagi dari ini kemungkinan membuat booking Shopee Express ditolak (UNVERIFIED) —
// form hanya MEMPERINGATKAN, tidak menolak, karena J&T tidak terikat aturan itu.
export const SPX_EARLIEST_PICKUP_HOUR = 14

// Jam & cutoff yang berlaku pada satu tanggal untuk satu ekspedisi (urutan prioritas di atas).
// `courier` kosong = pertanyaan "jam umum hari itu" (dipakai bila ekspedisi tak relevan).
// `special` true bila yang berlaku jam khusus tanggal, bukan jam rutin.
export function pickupHoursFor(
  date: string,
  schedule: PickupSchedule = DEFAULT_PICKUP_SCHEDULE,
  courier?: string | null,
): PickupHours & { special: boolean; label?: string } {
  const khususKurir = courier
    ? schedule.overrides.find((x) => x.date === date && x.courier === courier)
    : undefined
  const o = khususKurir ?? schedule.overrides.find((x) => x.date === date && !x.courier)
  if (o) {
    return {
      pickupHour: o.pickupHour,
      cutoffHour: o.cutoffHour,
      special: true,
      ...(o.label ? { label: o.label } : {}),
    }
  }
  const rutinKurir = courier ? schedule.couriers?.[courier] : undefined
  return { ...(rutinKurir ?? schedule.default), special: false }
}

// Jam jemput berbeda yang dipakai pada satu tanggal, masing-masing dengan satu ekspedisi wakilnya.
// Dipakai cron: satu slot Mengantar per jam jemput per alamat. Tanpa daftar ekspedisi → jam umum.
export function distinctPickupHours(
  date: string,
  schedule: PickupSchedule,
  couriers: readonly string[],
): { pickupHour: number; courier: string | null }[] {
  const daftar: (string | null)[] = couriers.length > 0 ? [...couriers] : [null]
  const byHour = new Map<number, string | null>()
  for (const c of daftar) {
    const { pickupHour } = pickupHoursFor(date, schedule, c)
    if (!byHour.has(pickupHour)) byHour.set(pickupHour, c)
  }
  return [...byHour.entries()]
    .map(([pickupHour, courier]) => ({ pickupHour, courier }))
    .sort((a, b) => a.pickupHour - b.pickupHour)
}

// Jumlah paket terbooking yang SEKARANG berada di jam yang berbeda dari jadwal baru. Paket itu tetap
// pada slot lamanya di Mengantar (tak ada reschedule di API), jadi admin perlu diberi tahu.
//
// Pembanding utamanya `slotHour` — jam slot yang BENAR-BENAR dipakai paket (pickup_time_id →
// mengantar_daily_pickup.pickup_hour), bukan jadwal sebelum disimpan. Bila dibandingkan dengan
// jadwal sebelumnya, admin yang mengubah jam lalu mengembalikannya (15 → 17 → 15) mendapat alarm
// palsu pada simpan kedua: paket yang memang di slot jam 15 terhitung "tertinggal di jam lama".
// `slotHour` tak diketahui (slot tak ditemukan / database tanpa kolom jam) → jatuh ke pembandingan
// jadwal sebelum vs sesudah seperti semula.
export function countOrdersOnChangedHour(
  before: PickupSchedule,
  after: PickupSchedule,
  orders: readonly { pickupDate: string; courier: string | null; slotHour?: number | null }[],
): number {
  return orders.filter((o) => {
    const jamBaru = pickupHoursFor(o.pickupDate, after, o.courier).pickupHour
    const jamPaket =
      typeof o.slotHour === 'number'
        ? o.slotHour
        : pickupHoursFor(o.pickupDate, before, o.courier).pickupHour
    return jamPaket !== jamBaru
  }).length
}

// Format jam untuk body POST /time Mengantar: "9:00", "17:00" — persis daftar di dokumentasinya
// (tanpa nol di depan untuk jam satu digit).
export function toMengantarTime(hour: number): string {
  return `${hour}:00`
}

// Format jam untuk tampilan: "09.00", "17.00".
export function formatPickupHour(hour: number): string {
  return `${pad2(hour)}.00`
}

// Pilihan cutoff yang sah untuk sebuah jam jemput (MIN_CUTOFF_HOUR … jam jemput − 2).
export function cutoffOptionsFor(pickupHour: number): number[] {
  const out: number[] = []
  for (let h = MIN_CUTOFF_HOUR; h <= pickupHour - MIN_CUTOFF_GAP_HOURS; h++) out.push(h)
  return out
}

// null bila pasangan jam sah; selain itu pesan untuk admin.
export function validatePickupHours(pickupHour: unknown, cutoffHour: unknown): string | null {
  if (typeof pickupHour !== 'number' || !MENGANTAR_PICKUP_HOURS.includes(pickupHour)) {
    return 'Jam jemput harus salah satu dari 09.00–18.00 (jam bulat), sesuai yang diterima Mengantar.'
  }
  if (typeof cutoffHour !== 'number' || !Number.isInteger(cutoffHour)) {
    return 'Batas pesanan (cutoff) harus jam bulat.'
  }
  if (cutoffHour < MIN_CUTOFF_HOUR) {
    return `Batas pesanan paling pagi ${formatPickupHour(MIN_CUTOFF_HOUR)}.`
  }
  if (cutoffHour > pickupHour - MIN_CUTOFF_GAP_HOURS) {
    return `Batas pesanan minimal ${MIN_CUTOFF_GAP_HOURS} jam sebelum jam jemput — Mengantar menolak slot yang kurang dari 90 menit dari waktu booking.`
  }
  return null
}

// Mengurai simpanan store_settings.pickup_schedule. Toleran: simpanan rusak atau kosong → jadwal
// bawaan, entri khusus yang rusak dilewati. Gangguan setting tak boleh mematikan booking kurir.
export function parsePickupSchedule(raw: string | null | undefined): PickupSchedule {
  if (!raw) return DEFAULT_PICKUP_SCHEDULE
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_PICKUP_SCHEDULE
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PICKUP_SCHEDULE
  const p = parsed as Record<string, unknown>
  const d = (typeof p.default === 'object' && p.default !== null ? p.default : {}) as Record<
    string,
    unknown
  >
  const def: PickupHours =
    validatePickupHours(d.pickupHour, d.cutoffHour) === null
      ? { pickupHour: d.pickupHour as number, cutoffHour: d.cutoffHour as number }
      : DEFAULT_PICKUP_HOURS

  // Jam rutin per ekspedisi: entri rusak dilewati, ekspedisi itu kembali memakai jam umum.
  const couriers: Record<string, PickupHours> = {}
  if (typeof p.couriers === 'object' && p.couriers !== null && !Array.isArray(p.couriers)) {
    for (const [kode, nilai] of Object.entries(p.couriers as Record<string, unknown>)) {
      if (!kode || typeof nilai !== 'object' || nilai === null) continue
      const h = nilai as Record<string, unknown>
      if (validatePickupHours(h.pickupHour, h.cutoffHour) !== null) continue
      couriers[kode] = { pickupHour: h.pickupHour as number, cutoffHour: h.cutoffHour as number }
    }
  }

  const overrides: PickupOverride[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(p.overrides) ? p.overrides : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const courier = typeof e.courier === 'string' && e.courier ? e.courier : undefined
    const kunci = overrideKey(String(e.date), courier)
    if (typeof e.date !== 'string' || parsePickupDate(e.date) === null || seen.has(kunci)) continue
    if (validatePickupHours(e.pickupHour, e.cutoffHour) !== null) continue
    seen.add(kunci)
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX) : ''
    overrides.push({
      date: e.date,
      pickupHour: e.pickupHour as number,
      cutoffHour: e.cutoffHour as number,
      ...(courier ? { courier } : {}),
      ...(label ? { label } : {}),
    })
  }
  overrides.sort(compareOverrides)
  return {
    default: def,
    ...(Object.keys(couriers).length > 0 ? { couriers } : {}),
    overrides,
  }
}

// Satu jam khusus per (tanggal, ekspedisi). Ekspedisi kosong = semua ekspedisi.
export function overrideKey(date: string, courier?: string | null): string {
  return `${date}|${courier ?? ''}`
}

// Urut tanggal, lalu "semua ekspedisi" sebelum ekspedisi tertentu.
function compareOverrides(a: PickupOverride, b: PickupOverride): number {
  return a.date.localeCompare(b.date) || (a.courier ?? '').localeCompare(b.courier ?? '')
}

export type NormalizedSchedule =
  | { ok: true; schedule: PickupSchedule; dropped: string[] }
  | { ok: false; error: string }

// Memvalidasi jadwal dari form admin. Ketat (pola normalizePickupHolidays): masukan salah DITOLAK
// dengan pesan; jam khusus untuk tanggal yang sudah lewat dibuang & dilaporkan di `dropped`.
//
// Jam khusus pada hari MINGGU ditolak: Minggu tak pernah ada penjemputan, jadi admin yang memilihnya
// pasti salah tanggal. Jam khusus pada HARI LIBUR admin justru DITERIMA: libur bisa didaftarkan
// belakangan pada tanggal yang sudah punya jam khusus, dan menolaknya di sini akan membuat seluruh
// jadwal tak bisa disimpan lagi. Libur tetap menang (isPickupDay), jam khususnya hanya tak berlaku,
// dan form menandainya. Form juga mencegah MENAMBAH jam khusus baru pada tanggal libur.
//
// `allowedCouriers` = kode ekspedisi yang ditawarkan ke pembeli (OFFERED_COURIER_IDS). Aturan untuk
// kode lain DITOLAK: jamnya tak akan pernah dipakai booking mana pun, dan kode salah ketik ('jt'
// kecil) akan diam-diam membuat J&T kembali ke jam umum.
export function normalizePickupSchedule(
  input: unknown,
  today: string,
  allowedCouriers: readonly string[] = [],
): NormalizedSchedule {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Jadwal penjemputan tidak valid.' }
  }
  const raw = input as Record<string, unknown>
  const d = (typeof raw.default === 'object' && raw.default !== null ? raw.default : {}) as Record<
    string,
    unknown
  >
  const defErr = validatePickupHours(d.pickupHour, d.cutoffHour)
  if (defErr) return { ok: false, error: `Jam rutin: ${defErr}` }

  const kurirSah = new Set(allowedCouriers)
  const couriers: Record<string, PickupHours> = {}
  if (raw.couriers !== undefined && raw.couriers !== null) {
    if (typeof raw.couriers !== 'object' || Array.isArray(raw.couriers)) {
      return { ok: false, error: 'Jam rutin per ekspedisi tidak valid.' }
    }
    for (const [kode, nilai] of Object.entries(raw.couriers as Record<string, unknown>)) {
      if (!kurirSah.has(kode)) return { ok: false, error: `Ekspedisi tidak dikenal: ${kode}.` }
      const h = (typeof nilai === 'object' && nilai !== null ? nilai : {}) as Record<string, unknown>
      const err = validatePickupHours(h.pickupHour, h.cutoffHour)
      if (err) return { ok: false, error: `Jam rutin ${kode}: ${err}` }
      couriers[kode] = { pickupHour: h.pickupHour as number, cutoffHour: h.cutoffHour as number }
    }
  }

  if (raw.overrides !== undefined && !Array.isArray(raw.overrides)) {
    return { ok: false, error: 'Daftar jam khusus harus berupa array.' }
  }
  const byDate = new Map<string, PickupOverride>()
  const dropped: string[] = []
  for (const entry of (raw.overrides as unknown[] | undefined) ?? []) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'Tiap jam khusus harus berisi tanggal dan jam.' }
    }
    const e = entry as Record<string, unknown>
    if (typeof e.date !== 'string' || parsePickupDate(e.date) === null) {
      return { ok: false, error: `Tanggal tidak valid: ${String(e.date ?? '(kosong)')}.` }
    }
    if (e.label !== undefined && e.label !== null && typeof e.label !== 'string') {
      return { ok: false, error: `Keterangan untuk ${e.date} harus berupa teks.` }
    }
    const courier = typeof e.courier === 'string' && e.courier ? e.courier : undefined
    if (e.courier !== undefined && e.courier !== null && e.courier !== '' && !courier) {
      return { ok: false, error: `Ekspedisi untuk ${e.date} tidak valid.` }
    }
    if (courier && !kurirSah.has(courier)) {
      return { ok: false, error: `Ekspedisi tidak dikenal: ${courier}.` }
    }
    if (e.date < today) {
      dropped.push(e.date)
      continue
    }
    const err = validatePickupHours(e.pickupHour, e.cutoffHour)
    if (err) return { ok: false, error: `${e.date}: ${err}` }
    if (!isPickupDay(e.date)) {
      return {
        ok: false,
        error: `${e.date} adalah hari Minggu — kurir tidak pernah dijadwalkan pada hari Minggu.`,
      }
    }
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX) : ''
    // Satu jam khusus per (tanggal, ekspedisi); entri kedua untuk kunci yang sama menimpa yang pertama.
    byDate.set(overrideKey(e.date, courier), {
      date: e.date,
      pickupHour: e.pickupHour as number,
      cutoffHour: e.cutoffHour as number,
      ...(courier ? { courier } : {}),
      ...(label ? { label } : {}),
    })
  }
  if (byDate.size > MAX_PICKUP_OVERRIDES) {
    return { ok: false, error: `Terlalu banyak jam khusus (maksimal ${MAX_PICKUP_OVERRIDES}).` }
  }
  return {
    ok: true,
    schedule: {
      default: { pickupHour: d.pickupHour as number, cutoffHour: d.cutoffHour as number },
      ...(Object.keys(couriers).length > 0 ? { couriers } : {}),
      overrides: [...byDate.values()].sort(compareOverrides),
    },
    dropped,
  }
}

// Tanggal slot yang harus DIBUAT ULANG setelah jadwal berubah: tanggal yang sudah punya slot di
// mengantar_daily_pickup (`slotDates`) dan jam jemputnya berbeda antara jadwal lama & baru.
//
// Slot di tabel itu tidak menyimpan jamnya sendiri — ia hanya time_id yang dibuat dengan jam yang
// berlaku saat itu. Tanpa membuangnya, cron dan booking terus memakai slot berjam lama karena
// "tanggal ini sudah punya slot". Perubahan CUTOFF saja tidak memerlukan slot baru: cutoff hanya
// dipakai sistem kita untuk memilih tanggal, tak pernah dikirim ke Mengantar.
//
// Sejak migration 20261014120000 slot menyimpan jamnya sendiri (kolom pickup_hour) dan fungsi ini
// hanya dipakai untuk database yang BELUM menjalankannya: di sana satu tanggal hanya bisa punya satu
// slot, jadi tanggal di-reset bila jam jemput salah satu ekspedisi (`couriers`) berubah.
export function slotDatesToReset(
  before: PickupSchedule,
  after: PickupSchedule,
  slotDates: readonly string[],
  couriers: readonly string[] = [],
): string[] {
  const daftar: (string | null)[] = [null, ...couriers]
  return [...new Set(slotDates)]
    .filter((date) =>
      daftar.some(
        (c) => pickupHoursFor(date, before, c).pickupHour !== pickupHoursFor(date, after, c).pickupHour,
      ),
    )
    .sort()
}
