// src/lib/email.ts
// Helper validasi & normalisasi alamat email untuk form checkout dan Lacak Pesanan.
// Modul MURNI (tanpa DB/fetch/env) supaya bisa dipakai komponen klien maupun route handler.
//
// ── Kenapa regex sederhana, bukan RFC 5322 ──
// Regex RFC 5322 penuh panjangnya ratusan karakter, tak terbaca, dan TETAP tak bisa menjawab
// pertanyaan yang sebenarnya penting: apakah kotak surat ini benar-benar ada. Satu-satunya cara
// menjawabnya adalah mengirim email verifikasi. Jadi tugas fungsi di sini cuma satu: menolak yang
// JELAS salah (tanpa @, tanpa domain, ada spasi) supaya pembeli sadar salah ketik sebelum submit.
// Alamat aneh-tapi-sah seperti `a+b@c.co.id` sengaja DILOLOSKAN — menolaknya lebih merugikan
// daripada meloloskannya.
//
// ── Kenapa dinormalisasi ke huruf kecil ──
// Bagian domain email tidak peka huruf besar/kecil, dan seluruh penyedia besar memperlakukan
// bagian lokalnya begitu juga. Tanpa normalisasi, `Budi@Gmail.com` saat checkout dan
// `budi@gmail.com` saat melacak pesanan menjadi DUA identitas berbeda — pembeli tak menemukan
// pesanannya sendiri padahal mengetik alamat yang sama. Normalisasi dilakukan di SATU tempat ini
// dan wajib dipakai baik saat menyimpan maupun saat mencari.

// Panjang maksimal alamat email (batas praktis; RFC membatasi 254 oktet).
export const EMAIL_MAX_LENGTH = 254

// Pola minimum yang dianggap sah:
//   - ada tepat satu '@'
//   - bagian sebelum '@' tidak kosong dan tanpa spasi
//   - bagian setelah '@' punya minimal satu titik, dan TLD-nya minimal 2 huruf
// Sengaja tidak lebih ketat dari ini — lihat catatan di kepala file.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/

// Menormalkan email → buang spasi di ujung lalu turunkan ke huruf kecil.
// WAJIB dipakai sebelum menyimpan ke DB dan sebelum dipakai mencari, supaya satu alamat tak
// pernah terpecah jadi dua identitas.
//
// Nilai non-string diperlakukan sebagai string kosong, bukan dibiarkan melempar. Sumbernya nyata:
// draf checkout yang tersimpan sebelum field email ada memasok `undefined`, dan `.trim()` di
// sini memutihkan seluruh halaman checkout. Penyebab utamanya ditambal di lib/checkout-draft.ts;
// penjaga ini memastikan pemanggil berikutnya tak bisa mengulang kesalahan yang sama.
export function normalizeEmail(raw: string): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

// Valid bila cocok pola minimum dan tidak melebihi batas panjang.
export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw)
  return e.length > 0 && e.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(e)
}

// Mengembalikan pesan error spesifik untuk sebuah email, atau '' bila valid.
//
// Urutan cek sengaja dari yang paling sering terjadi ke yang paling jarang, dan pesannya
// menyebutkan APA yang kurang — bukan "format email tidak valid" yang tak memberi tahu pembeli
// harus memperbaiki apa.
export function getEmailError(raw: string): string {
  const e = normalizeEmail(raw)
  if (e === '') return 'Email wajib diisi'
  if (e.length > EMAIL_MAX_LENGTH) return 'Email terlalu panjang'
  if (/\s/.test(e)) return 'Email tidak boleh mengandung spasi'

  const at = e.split('@')
  if (at.length === 1) return 'Email harus mengandung tanda @'
  if (at.length > 2) return 'Email hanya boleh punya satu tanda @'
  const [local, domain] = at
  if (local === '') return 'Bagian sebelum @ tidak boleh kosong'
  if (domain === '') return 'Bagian setelah @ tidak boleh kosong'
  if (!domain.includes('.')) return 'Domain email harus mengandung titik, contoh: gmail.com'

  // Sisa kasus (mis. titik di ujung domain, TLD satu huruf) tak layak dapat pesan sendiri —
  // jumlahnya banyak tapi kemunculannya jarang, dan pesan generik di sini sudah cukup menuntun.
  if (!EMAIL_PATTERN.test(e)) return 'Format email tidak valid, contoh: nama@gmail.com'
  return ''
}
