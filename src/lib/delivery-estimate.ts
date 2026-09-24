// src/lib/delivery-estimate.ts
// Mengubah estimasi lama pengiriman dari Mengantar ("2-4 hari") menjadi rentang tanggal tiba.
// Murni — tanpa I/O, aman dipakai di server maupun klien, dan diuji di tests/unit.
//
// Kenapa berkas tersendiri: bentuk `estimatedDate` tidak didokumentasikan Mengantar dengan ketat.
// Kalau suatu hari berubah ("2 - 4 Hari", "2~4 days", …), cukup berkas ini yang diperbaiki —
// kolom orders.estimasi_kirim menyimpan teks mentahnya, jadi tak butuh migration.

export type EstimateDays = { min: number; max: number }

// Perkiraan lama sebelum estimasi Mengantar disimpan (sampai 24 Sep 2026). Dipakai untuk pesanan
// lama dan untuk teks yang tak bisa diurai — lebih baik perkiraan wajar daripada tak ada sama sekali.
export const FALLBACK_ESTIMATE_DAYS: EstimateDays = { min: 2, max: 4 }

// Batas kewajaran. Angka di luar ini hampir pasti salah urai (mis. menangkap tahun dari tanggal),
// dan menjanjikannya ke pembeli lebih buruk daripada memakai perkiraan lama.
const MAX_DAYS = 30

const MS_PER_DAY = 86_400_000

// "2-4 hari" → { min: 2, max: 4 }; "3 hari" → { min: 3, max: 3 }. null bila tak dikenali.
export function parseEstimateDays(raw: string | null | undefined): EstimateDays | null {
  if (!raw) return null
  const angka = raw.match(/\d+/g)?.map(Number) ?? []
  if (angka.length === 0 || angka.length > 2) return null

  const min = angka[0]
  const max = angka.length === 2 ? angka[1] : angka[0]
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null
  if (min < 0 || max < min || max > MAX_DAYS) return null
  return { min, max }
}

// Rentang tanggal tiba untuk ditampilkan, mis. "26 Sep – 28 Sep".
//
// `startIso` sebaiknya waktu pesanan mulai diproses kurir (resi terbit), bukan waktu pesanan
// dibuat: pembeli bisa membayar berjam-jam kemudian, dan kurir baru bergerak setelah itu.
export function formatArrivalRange(
  startIso: string,
  estimate: EstimateDays | null,
  timeZone = 'Asia/Jakarta',
): string {
  const { min, max } = estimate ?? FALLBACK_ESTIMATE_DAYS
  const base = new Date(startIso)
  if (Number.isNaN(base.getTime())) {
    return min === max ? `${min} hari` : `${min}–${max} hari`
  }

  const fmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone })
  const from = fmt.format(new Date(base.getTime() + min * MS_PER_DAY))
  const to = fmt.format(new Date(base.getTime() + max * MS_PER_DAY))
  return from === to ? from : `${from} – ${to}`
}
