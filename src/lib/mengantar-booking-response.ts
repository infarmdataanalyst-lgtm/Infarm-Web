// src/lib/mengantar-booking-response.ts
// Membaca PENOLAKAN KURIR dari respons POST /order Mengantar. Modul murni (tanpa fetch, tanpa
// API key) supaya bisa diuji dengan payload sungguhan.
//
// ── Bentuk yang ditangani ──
// Mengantar bisa membalas `success: true` padahal kurirnya menolak kiriman itu: datanya tetap
// dibuat (punya `_id`), tapi berstatus error dan tanpa `cnote_no`. Terukur 2026-10-05,
// INV-20261005-YV2GX0NS (SPX, Gudang Utama → Gomo, Nias Selatan):
//
//   {"success":true,"data":[{"COD_AMOUNT":0,"status":"error","statusCategory":"error",
//     "isPaid":true,"isPreviouslyError":true,"cargo":false,"_id":"6ac344e96e4ade8c8bc457e5", …
//
// Saldo TIDAK terpotong untuk kiriman seperti ini (dashboard Mengantar tak mencatat transaksi apa
// pun), jadi `_id`-nya tak perlu dihapus — tapi tetap dicatat agar admin bisa menunjukkannya ke
// support Mengantar.
//
// Sebelumnya kasus ini jatuh ke cabang "tanpa cnote_no" yang hanya menyimpan 200 karakter pertama
// respons — alasan penolakannya terpotong sebelum sempat terbaca.

// Kunci yang kemungkinan membawa alasan penolakan. Nama field-nya belum pernah terlihat utuh
// (respons di atas terpotong), jadi dicocokkan longgar alih-alih ditebak satu nama.
const MESSAGE_KEY = /message|error|reason|remark|note|desc|keterangan|alasan/i
// Cocok dengan pola di atas tapi bukan alasan — hanya penanda.
const NOT_A_MESSAGE = new Set(['isPreviouslyError', 'statusCategory'])

const FALLBACK_MAX = 350

// Ringkasan penolakan kurir, atau null bila respons ini bukan penolakan (resi terbit, atau bentuk
// lain yang ditangani cabang berbeda). Formatnya: `_id=<id>; <alasan>`.
export function describeCourierRejection(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const data = (body as Record<string, unknown>).data
  if (!Array.isArray(data)) return null
  const first: unknown = data[0]
  if (typeof first !== 'object' || first === null) return null
  const row = first as Record<string, unknown>

  // Resi terbit = bukan penolakan, apa pun isi field lainnya.
  if (typeof row.cnote_no === 'string' && row.cnote_no.trim()) return null

  const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
  if (lower(row.status) !== 'error' && lower(row.statusCategory) !== 'error') return null

  const id = typeof row._id === 'string' && row._id.trim() ? row._id.trim() : undefined

  const alasan = Object.entries(row)
    .filter(([key]) => MESSAGE_KEY.test(key) && !NOT_A_MESSAGE.has(key))
    .map(([key, value]) => {
      if (typeof value === 'string' && value.trim()) return `${key}=${value.trim()}`
      if (typeof value === 'object' && value !== null) return `${key}=${JSON.stringify(value)}`
      return null
    })
    .filter((s): s is string => s !== null)

  // Tanpa field alasan, simpan isi item itu sendiri: lebih berguna bagi admin (dan bagi kita untuk
  // menemukan nama field yang benar) daripada "tak ada alasan" saja.
  const isi =
    alasan.length > 0
      ? alasan.join('; ')
      : `Mengantar tak menyertakan alasan: ${JSON.stringify(row).slice(0, FALLBACK_MAX)}`

  return `${id ? `_id=${id}; ` : ''}${isi}`
}
