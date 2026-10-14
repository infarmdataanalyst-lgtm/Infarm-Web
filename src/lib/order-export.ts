// src/lib/order-export.ts
// Nama berkas ekspor CSV halaman Pesanan OMS. Fungsi murni supaya bisa diuji tanpa browser.
//
// Selalu memuat tanggal (format ringkas YYYYMMDD, WIB) — keputusan pemilik 2026-10-14. Dulu nama
// berkas tanpa filter tanggal hanya "pesanan.csv", sehingga ekspor dari hari berbeda tertumpuk di
// folder Unduhan sebagai pesanan (1).csv, pesanan (2).csv, … dan tak bisa dibedakan.
//
//   tanpa filter tanggal  → pesanan_20261014.csv            (tanggal ekspor)
//   dengan filter tanggal → pesanan_20261001-20261014.csv   (rentang yang diekspor)
//
// Batas yang tak diisi: "dari" kosong → "awal", "sampai" kosong → tanggal ekspor.

// "2026-10-14" → "20261014"
function compact(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

// Tanggal hari ini di zona WIB, "YYYY-MM-DD" (sv-SE memang berformat ISO).
function todayWib(nowMs: number): string {
  return new Date(nowMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
}

export function orderExportFileName(dari: string, sampai: string, nowMs: number = Date.now()): string {
  const today = compact(todayWib(nowMs))
  if (!dari && !sampai) return `pesanan_${today}.csv`
  const from = dari ? compact(dari) : 'awal'
  const to = sampai ? compact(sampai) : today
  return from === to ? `pesanan_${from}.csv` : `pesanan_${from}-${to}.csv`
}
