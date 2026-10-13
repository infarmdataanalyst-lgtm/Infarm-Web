// tests/unit/pickup-schedule.test.ts
// Aturan tanggal penjemputan kurir: hari kerja, cutoff 15.00 WIB, Minggu, dan hari libur admin.
// Salah di sini = slot pickup dibuat untuk hari gudang tutup (kurir datang ke gudang kosong) atau
// pesanan menunggu satu hari lebih lama dari perlunya. Semua instant ditulis dalam UTC lalu
// dikomentari jam WIB-nya, karena di situlah kesalahan zona waktu biasanya bersembunyi.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PICKUP_SCHEDULE,
  MAX_PICKUP_HOLIDAYS,
  NO_HOLIDAYS,
  PICKUP_HOLIDAY_LABEL_MAX,
  cutoffOptionsFor,
  formatPickupHour,
  isPickupDay,
  nextPickupDate,
  normalizePickupHolidays,
  normalizePickupSchedule,
  parsePickupHolidays,
  parsePickupSchedule,
  pickupHoursFor,
  resolvePickupDate,
  slotDatesToReset,
  toHolidaySet,
  toMengantarTime,
  validatePickupHours,
  type PickupSchedule,
} from '@/lib/pickup-schedule'

// Kalender Oktober 2026: Sabtu 10, Minggu 11, Senin 12, …, Sabtu 17, Minggu 18, Senin 19.
const SABTU_10 = '2026-10-10'
const MINGGU_11 = '2026-10-11'
const SENIN_12 = '2026-10-12'
const SENIN_19 = '2026-10-19'

// Libur beruntun Selasa 13 – Sabtu 17 (lima hari kerja), disusul Minggu 18.
const LIBUR_LIMA_HARI = toHolidaySet([
  { date: '2026-10-13', label: 'Libur uji' },
  { date: '2026-10-14' },
  { date: '2026-10-15' },
  { date: '2026-10-16' },
  { date: '2026-10-17' },
])

// WIB = UTC+7. Helper ini menerima jam dinding WIB supaya test terbaca seperti jadwal gudang.
const wib = (y: number, m: number, d: number, h: number, min = 0) =>
  Date.UTC(y, m - 1, d, h - 7, min)

describe('isPickupDay', () => {
  it('Senin–Sabtu hari pickup, Minggu bukan', () => {
    expect(isPickupDay(SABTU_10)).toBe(true)
    expect(isPickupDay(MINGGU_11)).toBe(false)
    expect(isPickupDay(SENIN_12)).toBe(true)
  })

  it('hari libur admin bukan hari pickup meski hari kerja', () => {
    expect(isPickupDay('2026-10-13')).toBe(true)
    expect(isPickupDay('2026-10-13', LIBUR_LIMA_HARI)).toBe(false)
  })

  it('format tak valid selalu false', () => {
    expect(isPickupDay('2026-02-30')).toBe(false)
    expect(isPickupDay('12-10-2026')).toBe(false)
  })
})

describe('nextPickupDate', () => {
  it('melompati Minggu', () => {
    expect(nextPickupDate(SABTU_10)).toBe(SENIN_12)
    expect(nextPickupDate(MINGGU_11)).toBe(SENIN_12)
  })

  it('melompati libur beruntun DAN Minggu sesudahnya', () => {
    expect(nextPickupDate(SENIN_12, LIBUR_LIMA_HARI)).toBe(SENIN_19)
  })

  it('tanpa daftar libur, Selasa 13 tetap hari kerja biasa', () => {
    expect(nextPickupDate(SENIN_12)).toBe('2026-10-13')
  })
})

describe('resolvePickupDate', () => {
  it('sebelum cutoff di hari kerja → hari ini', () => {
    const r = resolvePickupDate(wib(2026, 10, 10, 14, 59)) // Sabtu 14.59 WIB
    expect(r).toMatchObject({ date: SABTU_10, reason: 'hari-ini', today: SABTU_10, hour: 14 })
  })

  it('tepat 15.00 WIB sudah lewat cutoff; Sabtu sore langsung ke Senin', () => {
    const r = resolvePickupDate(wib(2026, 10, 10, 15, 0))
    expect(r).toMatchObject({ date: SENIN_12, reason: 'lewat-cutoff', hour: 15 })
  })

  it('Minggu jam berapa pun → Senin, termasuk menjelang tengah malam WIB', () => {
    expect(resolvePickupDate(wib(2026, 10, 11, 10, 0))).toMatchObject({
      date: SENIN_12,
      reason: 'bukan-hari-pickup',
      today: MINGGU_11,
    })
    // 23.30 WIB Minggu = 16.30 UTC Minggu. Kalau dihitung dengan jam UTC server, masih "Minggu"
    // juga — tapi 05.00 WIB Senin di bawah adalah jebakan sebenarnya.
    expect(resolvePickupDate(wib(2026, 10, 11, 23, 30))).toMatchObject({ date: SENIN_12 })
  })

  it('Senin 05.00 WIB (masih Minggu di UTC) sudah dihitung Senin', () => {
    const r = resolvePickupDate(wib(2026, 10, 12, 5, 0)) // = Minggu 22.00 UTC
    expect(r).toMatchObject({ date: SENIN_12, reason: 'hari-ini', today: SENIN_12, hour: 5 })
  })

  it('hari libur admin → hari kerja pertama setelah seluruh rangkaian libur', () => {
    const r = resolvePickupDate(wib(2026, 10, 13, 10, 0), LIBUR_LIMA_HARI) // Selasa, hari libur
    expect(r).toMatchObject({ date: SENIN_19, reason: 'hari-libur', today: '2026-10-13' })
  })

  it('sehari sebelum libur, sebelum cutoff, tetap dijemput hari itu', () => {
    const r = resolvePickupDate(wib(2026, 10, 12, 9, 0), LIBUR_LIMA_HARI) // Senin pagi
    expect(r).toMatchObject({ date: SENIN_12, reason: 'hari-ini' })
  })

  it('sehari sebelum libur, lewat cutoff → melompati seluruh libur', () => {
    const r = resolvePickupDate(wib(2026, 10, 12, 16, 0), LIBUR_LIMA_HARI)
    expect(r).toMatchObject({ date: SENIN_19, reason: 'lewat-cutoff' })
  })
})

describe('parsePickupHolidays (baca simpanan, toleran)', () => {
  it('kosong / bukan JSON / bukan array → daftar kosong', () => {
    expect(parsePickupHolidays(null)).toEqual([])
    expect(parsePickupHolidays('')).toEqual([])
    expect(parsePickupHolidays('bukan json')).toEqual([])
    expect(parsePickupHolidays('{"date":"2026-10-13"}')).toEqual([])
  })

  it('menerima string maupun objek, melewati entri rusak, membuang duplikat, mengurutkan', () => {
    const raw = JSON.stringify([
      { date: '2026-10-15', label: '  Cuti bersama ' },
      '2026-10-13',
      { date: '2026-02-30' }, // tanggal mustahil → dilewati
      { date: '2026-10-13', label: 'duplikat' }, // sudah ada → dilewati
      { label: 'tanpa tanggal' },
      42,
    ])
    expect(parsePickupHolidays(raw)).toEqual([
      { date: '2026-10-13' },
      { date: '2026-10-15', label: 'Cuti bersama' },
    ])
  })

  it('label dipotong ke batas panjang', () => {
    const raw = JSON.stringify([{ date: '2026-10-13', label: 'x'.repeat(PICKUP_HOLIDAY_LABEL_MAX + 10) }])
    expect(parsePickupHolidays(raw)[0].label).toHaveLength(PICKUP_HOLIDAY_LABEL_MAX)
  })
})

describe('normalizePickupHolidays (masukan admin, ketat)', () => {
  const HARI_INI = SENIN_12

  it('menolak bentuk yang bukan daftar atau entri tanpa tanggal valid', () => {
    expect(normalizePickupHolidays('2026-10-13', HARI_INI)).toMatchObject({ ok: false })
    expect(normalizePickupHolidays(['2026-10-13'], HARI_INI)).toMatchObject({ ok: false })
    expect(normalizePickupHolidays([{ date: '13-10-2026' }], HARI_INI)).toMatchObject({ ok: false })
    expect(normalizePickupHolidays([{ date: '2026-02-30' }], HARI_INI)).toMatchObject({ ok: false })
    expect(normalizePickupHolidays([{ date: '2026-10-13', label: 7 }], HARI_INI)).toMatchObject({ ok: false })
  })

  it('membuang tanggal lampau tanpa menolak sisanya, melapor di `dropped`', () => {
    const r = normalizePickupHolidays(
      [{ date: '2026-10-09' }, { date: HARI_INI }, { date: '2026-10-13' }],
      HARI_INI,
    )
    expect(r).toEqual({
      ok: true,
      holidays: [{ date: HARI_INI }, { date: '2026-10-13' }],
      dropped: ['2026-10-09'],
    })
  })

  it('melebur duplikat (entri terakhir menang), memangkas label, mengurutkan', () => {
    const r = normalizePickupHolidays(
      [
        { date: '2026-10-15', label: '' },
        { date: '2026-10-13', label: ' Idul Fitri ' },
        { date: '2026-10-13', label: 'Cuti bersama' },
      ],
      HARI_INI,
    )
    expect(r).toEqual({
      ok: true,
      holidays: [{ date: '2026-10-13', label: 'Cuti bersama' }, { date: '2026-10-15' }],
      dropped: [],
    })
  })

  it('menolak daftar yang melebihi batas', () => {
    const banyak = Array.from({ length: MAX_PICKUP_HOLIDAYS + 1 }, (_, i) => {
      const d = new Date(Date.UTC(2027, 0, 1 + i))
      return { date: d.toISOString().slice(0, 10) }
    })
    expect(normalizePickupHolidays(banyak, HARI_INI)).toMatchObject({ ok: false })
    expect(normalizePickupHolidays(banyak.slice(0, MAX_PICKUP_HOLIDAYS), HARI_INI)).toMatchObject({ ok: true })
  })

  it('libur sebanyak batas tetap bisa dilompati nextPickupDate', () => {
    // 60 hari berturut sejak Selasa 13 Okt, termasuk Minggu di dalamnya.
    const list = Array.from({ length: MAX_PICKUP_HOLIDAYS }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10),
    }))
    const next = nextPickupDate(SENIN_12, toHolidaySet(list))
    expect(next).not.toBeNull()
    expect(isPickupDay(next!, toHolidaySet(list))).toBe(true)
    expect(next! > list[list.length - 1].date).toBe(true)
  })
})

// === Jam penjemputan & cutoff dari OMS ===

const SELASA_13 = '2026-10-13'
const RABU_14 = '2026-10-14'

// Jam rutin 17/15, dan Selasa 13 kurir datang lebih awal: jemput 12.00, batas pesanan 10.00.
const JADWAL: PickupSchedule = {
  default: { pickupHour: 17, cutoffHour: 15 },
  overrides: [{ date: SELASA_13, pickupHour: 12, cutoffHour: 10, label: 'Stok opname' }],
}

describe('resolvePickupDate dengan jam dari OMS', () => {
  it('tanpa jadwal → perilaku lama persis (cutoff 15.00)', () => {
    expect(resolvePickupDate(wib(2026, 10, 13, 14, 59)).date).toBe(SELASA_13)
    expect(resolvePickupDate(wib(2026, 10, 13, 15, 0)).date).toBe(RABU_14)
  })

  it('hari berjam khusus memakai cutoff khususnya: 10.30 sudah ikut besok', () => {
    const r = resolvePickupDate(wib(2026, 10, 13, 10, 30), NO_HOLIDAYS, JADWAL)
    expect(r).toMatchObject({ date: RABU_14, reason: 'lewat-cutoff' })
  })

  it('hari berjam khusus, sebelum cutoff khusus → hari itu', () => {
    expect(resolvePickupDate(wib(2026, 10, 13, 9, 59), NO_HOLIDAYS, JADWAL).date).toBe(SELASA_13)
  })

  it('hari lain tetap memakai jam rutin', () => {
    expect(resolvePickupDate(wib(2026, 10, 14, 14, 0), NO_HOLIDAYS, JADWAL).date).toBe(RABU_14)
  })

  it('jam rutin yang diubah (cutoff 12.00) berlaku untuk semua hari tanpa jam khusus', () => {
    const awal: PickupSchedule = { default: { pickupHour: 14, cutoffHour: 12 }, overrides: [] }
    expect(resolvePickupDate(wib(2026, 10, 14, 12, 0), NO_HOLIDAYS, awal).reason).toBe('lewat-cutoff')
  })
})

describe('pickupHoursFor & format', () => {
  it('jam khusus menang atas jam rutin, beserta labelnya', () => {
    expect(pickupHoursFor(SELASA_13, JADWAL)).toEqual({
      pickupHour: 12,
      cutoffHour: 10,
      special: true,
      label: 'Stok opname',
    })
    expect(pickupHoursFor(RABU_14, JADWAL)).toEqual({ pickupHour: 17, cutoffHour: 15, special: false })
  })

  it('format Mengantar tanpa nol di depan, format tampilan dengan nol', () => {
    expect(toMengantarTime(9)).toBe('9:00')
    expect(toMengantarTime(17)).toBe('17:00')
    expect(formatPickupHour(9)).toBe('09.00')
  })

  it('pilihan cutoff berhenti 2 jam sebelum jemput', () => {
    expect(cutoffOptionsFor(17).at(-1)).toBe(15)
    expect(cutoffOptionsFor(9)).toEqual([6, 7])
  })
})

describe('validatePickupHours', () => {
  it('menerima pasangan sah', () => {
    expect(validatePickupHours(17, 15)).toBeNull()
    expect(validatePickupHours(9, 7)).toBeNull()
  })

  it('jam jemput di luar 09–18 ditolak (Mengantar tak menerimanya)', () => {
    expect(validatePickupHours(8, 6)).not.toBeNull()
    expect(validatePickupHours(19, 15)).not.toBeNull()
    expect(validatePickupHours(16.5, 14)).not.toBeNull()
  })

  it('cutoff kurang dari 2 jam sebelum jemput ditolak (aturan 90 menit Mengantar)', () => {
    expect(validatePickupHours(17, 16)).toMatch(/2 jam/)
    expect(validatePickupHours(17, 17)).not.toBeNull()
  })

  it('cutoff terlalu pagi atau bukan angka ditolak', () => {
    expect(validatePickupHours(12, 5)).not.toBeNull()
    expect(validatePickupHours(12, '10')).not.toBeNull()
  })
})

describe('parsePickupSchedule (baca simpanan, toleran)', () => {
  it('kosong / rusak → jadwal bawaan 17.00 / 15.00', () => {
    expect(parsePickupSchedule(null)).toEqual(DEFAULT_PICKUP_SCHEDULE)
    expect(parsePickupSchedule('bukan json')).toEqual(DEFAULT_PICKUP_SCHEDULE)
    expect(DEFAULT_PICKUP_SCHEDULE.default).toEqual({ pickupHour: 17, cutoffHour: 15 })
  })

  it('jam rutin tak sah → bawaan; jam khusus rusak dilewati, yang sah tetap', () => {
    const raw = JSON.stringify({
      default: { pickupHour: 20, cutoffHour: 15 },
      overrides: [
        { date: SELASA_13, pickupHour: 12, cutoffHour: 10 },
        { date: RABU_14, pickupHour: 12, cutoffHour: 11 }, // jarak 1 jam → dilewati
        { date: 'bukan-tanggal', pickupHour: 12, cutoffHour: 10 },
      ],
    })
    expect(parsePickupSchedule(raw)).toEqual({
      default: DEFAULT_PICKUP_SCHEDULE.default,
      overrides: [{ date: SELASA_13, pickupHour: 12, cutoffHour: 10 }],
    })
  })
})

describe('normalizePickupSchedule (masukan admin, ketat)', () => {
  const sah = { default: { pickupHour: 17, cutoffHour: 15 }, overrides: [] }

  it('jadwal sah diterima, jam khusus diurutkan dan labelnya dipotong', () => {
    const r = normalizePickupSchedule(
      {
        ...sah,
        overrides: [
          { date: RABU_14, pickupHour: 13, cutoffHour: 11 },
          { date: SELASA_13, pickupHour: 12, cutoffHour: 10, label: 'x'.repeat(100) },
        ],
      },
      '2026-10-13',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.schedule.overrides.map((o) => o.date)).toEqual([SELASA_13, RABU_14])
    expect(r.schedule.overrides[0].label).toHaveLength(PICKUP_HOLIDAY_LABEL_MAX)
  })

  it('jam khusus yang sudah lewat dibuang & dilaporkan', () => {
    const r = normalizePickupSchedule(
      { ...sah, overrides: [{ date: SENIN_12, pickupHour: 12, cutoffHour: 10 }] },
      '2026-10-13',
    )
    expect(r).toEqual({ ok: true, schedule: sah, dropped: [SENIN_12] })
  })

  it('jam khusus pada hari Minggu ditolak', () => {
    const r = normalizePickupSchedule(
      { ...sah, overrides: [{ date: '2026-10-18', pickupHour: 12, cutoffHour: 10 }] },
      '2026-10-13',
    )
    expect(r.ok).toBe(false)
  })

  it('jam rutin tak sah ditolak dengan pesan', () => {
    const r = normalizePickupSchedule({ default: { pickupHour: 17, cutoffHour: 16 } }, '2026-10-13')
    expect(r).toMatchObject({ ok: false })
  })
})

describe('slotDatesToReset', () => {
  const SLOT = [SELASA_13, RABU_14]

  it('ubah jam jemput rutin → semua slot tanpa jam khusus dibuat ulang', () => {
    const sesudah: PickupSchedule = { ...JADWAL, default: { pickupHour: 16, cutoffHour: 14 } }
    expect(slotDatesToReset(JADWAL, sesudah, SLOT)).toEqual([RABU_14])
  })

  it('tambah jam khusus untuk tanggal yang slotnya sudah ada → slot itu dibuat ulang', () => {
    const sesudah: PickupSchedule = {
      ...JADWAL,
      overrides: [...JADWAL.overrides, { date: RABU_14, pickupHour: 12, cutoffHour: 10 }],
    }
    expect(slotDatesToReset(JADWAL, sesudah, SLOT)).toEqual([RABU_14])
  })

  it('hanya cutoff yang berubah → tak ada slot dibuat ulang (cutoff tak dikirim ke Mengantar)', () => {
    const sesudah: PickupSchedule = { ...JADWAL, default: { pickupHour: 17, cutoffHour: 12 } }
    expect(slotDatesToReset(JADWAL, sesudah, SLOT)).toEqual([])
  })

  it('hapus jam khusus yang jamnya beda dari rutin → slot tanggal itu dibuat ulang', () => {
    const sesudah: PickupSchedule = { ...JADWAL, overrides: [] }
    expect(slotDatesToReset(JADWAL, sesudah, SLOT)).toEqual([SELASA_13])
  })
})
