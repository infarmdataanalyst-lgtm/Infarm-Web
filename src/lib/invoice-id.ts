// src/lib/invoice-id.ts
// Validasi bentuk nomor invoice. Murni — tanpa I/O, tanpa rahasia, aman diimpor dari mana pun.
//
// ── Yang dijaga, dan yang TIDAK ──
// Ini BUKAN pertahanan terhadap SQL injection. Nilai invoice selalu masuk ke `.eq()` PostgREST
// yang terparameter, bukan `.ilike()`, jadi persoalan wildcard SEC-023 tak berlaku di sini dan
// menyebutnya sebagai alasan hanya akan menyesatkan pembaca berikutnya.
//
// Yang dijaga dua hal yang lebih sepele tapi nyata (SEC-052):
//   1. BARIS BARU. Nilai invoice masuk ke `console.log` apa adanya, dan log itulah yang dipakai
//      menginvestigasi pengembalian dana. Satu `\n` di dalamnya sudah cukup untuk menyisipkan
//      baris log palsu — jejak yang seharusnya menjadi bukti justru bisa dikarang pemanggilnya.
//   2. STRING RAKSASA yang diteruskan apa adanya ke query.
//
// ── Kenapa TIDAK mewajibkan awalan `INV-` ──
// Database ini memuat pesanan berpola lain (OMS-RESI-001, MGT-ORIGIN-001). Menolak berdasarkan
// awalan akan mematikan penanganan pesanan yang sah demi kerapian yang tak menambah keamanan
// sedikit pun — yang berbahaya adalah karakternya, bukan awalannya.

// Huruf, angka, dan tanda hubung. Cukup untuk setiap pola nomor yang dipakai project ini, dan
// tak memuat satu pun karakter yang bisa memalsukan baris log.
const POLA_INVOICE = /^[A-Za-z0-9-]{1,64}$/

// Merapikan lalu memvalidasi nomor invoice yang datang dari body permintaan.
//
// `null` berarti nilainya bukan nomor invoice yang berbentuk wajar — pemanggil membalas 400.
// Awalan `#` dibuang lebih dulu karena tim gudang terbiasa menyalin nomor bersama tanda itu.
export function normalizeInvoiceId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const bersih = raw.trim().replace(/^#/, '')
  return POLA_INVOICE.test(bersih) ? bersih : null
}
