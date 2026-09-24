// src/lib/ga-client-id.ts
// Membaca penanda Google Analytics 4 dari cookie di browser: `client_id` (cookie `_ga`) dan
// `session_id` (cookie `_ga_<measurement-id>`).
//
// Dipakai checkout untuk menitipkan keduanya ke pesanan, supaya webhook Xendit bisa mengirim
// event `purchase` atas nama pembeli yang benar (lihat migration 20260923120000) DAN menempel ke
// kunjungan yang benar (migration 20260924120000).
//
// Keduanya menjawab pertanyaan berbeda:
//   client_id  → SIAPA yang membeli (browser mana)
//   session_id → dari KUNJUNGAN MANA, dan dari kunjungan itulah GA4 tahu kanal asalnya
// Tanpa yang kedua, seluruh penjualan mendarat di baris "Unassigned" pada laporan Akuisisi
// traffic — terbukti di produksi 24 Sep 2026.
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

// === session_id ===
//
// GA4 menyimpannya di cookie bernama `_ga_<measurement-id tanpa awalan G->`. Untuk
// `G-ABC123XYZ`, nama cookienya `_ga_ABC123XYZ`.
//
// ⚠️ Bentuk isinya TIDAK didokumentasikan Google dan sudah berganti sekali. Dua bentuk yang
// diketahui:
//
//   GS1.1.1758600000.3.1.1758600120.0.0.0
//        └─ bagian ke-3 = session_id, angka polos
//
//   GS2.1.s1758600000$o3$g1$t1758600120$j60$l0$h0
//        └─ bagian ke-3 diawali huruf 's' dan ruasnya dipisah '$'
//
// Parser di bawah menangani keduanya dengan mengambil bagian ketiga, membuang awalan 's', lalu
// memotong di '$' pertama. Bentuk ketiga yang belum pernah kita lihat akan gagal validasi angka
// dan diperlakukan sebagai "tidak ada session_id" — pesanan tetap tersimpan, hanya atribusi
// sesinya yang hilang. Ini disengaja: menebak isi cookie yang berubah lebih berbahaya daripada
// kehilangan satu baris atribusi, karena GA4 menerima nilai apa pun tanpa mengeluh.

// Ambil session_id dari NILAI cookie `_ga_<id>`. Fungsi murni supaya bisa diuji tanpa browser.
export function parseGaSessionCookie(value: string): string | undefined {
  const parts = value.trim().split('.')
  if (parts.length < 3) return undefined

  // GS2 menaruh beberapa ruas ber-awalan huruf di bagian yang sama, dipisah '$'. GS1 tidak punya
  // '$' sama sekali, jadi pemotongan ini aman untuk keduanya.
  const ruas = parts[2].split('$')[0]
  const angka = ruas.startsWith('s') ? ruas.slice(1) : ruas

  return /^\d+$/.test(angka) ? angka : undefined
}

// Nama cookie session untuk sebuah Measurement ID. `G-ABC123` → `_ga_ABC123`.
export function gaSessionCookieName(measurementId: string): string {
  return `_ga_${measurementId.trim().replace(/^G-/, '')}`
}

// Baca session_id dari document.cookie. undefined bila GA tak terpasang, cookie diblokir,
// NEXT_PUBLIC_GA_ID kosong, atau bentuk cookienya tak dikenali.
export function readGaSessionId(): string | undefined {
  if (typeof document === 'undefined') return undefined

  const measurementId = process.env.NEXT_PUBLIC_GA_ID?.trim()
  if (!measurementId) return undefined

  // Nama cookie dicari apa adanya, bukan lewat regex yang disusun dari measurement ID — nilainya
  // datang dari environment dan tak perlu ikut menyusun pola.
  const nama = gaSessionCookieName(measurementId)
  const potongan = document.cookie.split(';')
  for (const bagian of potongan) {
    const isi = bagian.trim()
    if (!isi.startsWith(`${nama}=`)) continue
    try {
      return parseGaSessionCookie(decodeURIComponent(isi.slice(nama.length + 1)))
    } catch {
      // Cookie rusak (persentase tak lengkap). Alasan sama dengan readGaClientId: proses bayar
      // yang sedang berjalan tak boleh jatuh karenanya.
      return undefined
    }
  }
  return undefined
}
