// src/lib/ga-client-id.ts
// Membaca client_id Google Analytics 4 dari cookie `_ga` di browser.
//
// Dipakai checkout untuk menitipkan client_id ke pesanan, supaya webhook Xendit bisa mengirim
// event `purchase` atas nama pembeli yang benar (lihat migration 20260923120000).
//
// ── Bentuk cookie ──
// GA4 menulis `_ga` dengan bentuk `GA<versi>.<jumlah-bagian-domain>.<client_id>`, dan client_id
// sendiri dua angka dipisah titik — mis. `GA1.1.1234567890.1234567890` → `1234567890.1234567890`.
// Dua bagian terakhir itulah yang diminta Measurement Protocol.
//
// Mengambil DUA BAGIAN TERAKHIR, bukan indeks 2 dan 3: pada domain dengan lebih banyak bagian
// (mis. subdomain) angka kedua berubah dan sebagian implementasi menyisipkan bagian tambahan di
// depan. Yang stabil adalah posisinya dari belakang.
//
// Bentuk ini tidak didokumentasikan Google sebagai kontrak resmi. Karena itu hasilnya SELALU
// divalidasi, dan kegagalan parsing diperlakukan sebagai "tidak ada client_id" — bukan dilempar.
// Pesanan tetap tersimpan; yang hilang hanya atribusinya.

// Ambil client_id dari NILAI cookie `_ga`. Fungsi murni supaya bisa diuji tanpa browser.
// undefined bila bentuknya tak dikenali.
export function parseGaCookie(value: string): string | undefined {
  const parts = value.trim().split('.')
  if (parts.length < 4) return undefined

  const clientId = parts.slice(-2).join('.')
  // Dua angka bulat dipisah titik. Validasi ini yang menjaga kita dari mengirim potongan cookie
  // yang bentuknya berubah — GA4 akan menerima string apa pun tanpa mengeluh, lalu menghitungnya
  // sebagai pengunjung yang tak pernah ada.
  return /^\d+\.\d+$/.test(clientId) ? clientId : undefined
}

// Baca dari document.cookie. undefined bila GA tak terpasang, cookie diblokir, atau dipanggil
// di server.
export function readGaClientId(): string | undefined {
  if (typeof document === 'undefined') return undefined

  const match = document.cookie.match(/(?:^|;\s*)_ga=([^;]+)/)
  if (!match) return undefined

  try {
    return parseGaCookie(decodeURIComponent(match[1]))
  } catch {
    // decodeURIComponent melempar pada persentase yang tak lengkap. Cookie rusak = tak ada
    // client_id; ia tak boleh menjatuhkan proses bayar yang sedang berjalan.
    return undefined
  }
}
