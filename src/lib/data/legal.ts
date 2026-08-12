// src/lib/data/legal.ts
// Konstanta bersama halaman legal (Kebijakan Privasi & Syarat/Ketentuan) —
// dipakai juga oleh footer & bilah checkout agar tidak ada nilai yang di-hardcode dua kali.

// TODO(infarm): ganti ke alamat email & nomor CS resmi sebelum go-live.
// Keduanya PLACEHOLDER — dipakai di kedua halaman legal sebagai kanal kontak resmi.
export const LEGAL_CONTACT_EMAIL = 'cs@infarm.id'
export const LEGAL_CONTACT_PHONE = '+62 811-0000-0000'

// Tanggal berlaku yang ditampilkan di kepala kedua dokumen.
// Perbarui manual setiap kali isi dokumen berubah secara material.
export const LEGAL_EFFECTIVE_DATE = '7 Agustus 2026'

// Rute halaman legal (satu sumber agar tautan di footer/checkout tak salah tulis)
export const PRIVACY_POLICY_PATH = '/privacy-policy'
export const TERMS_PATH = '/terms-and-conditions'

// === Tuas aktif/nonaktif halaman legal ===
//
// false = halaman Kebijakan Privasi & Syarat/Ketentuan TIDAK bisa diakses (balas 404) dan seluruh
// tautan ke keduanya disembunyikan. Diminta pemilik toko: dokumennya belum diperlukan sekarang.
//
// KODENYA SENGAJA DIPERTAHANKAN UTUH — `src/app/{privacy-policy,terms-and-conditions}/page.tsx`,
// `components/legal/LegalPageShell.tsx`, dan seluruh konstanta di file ini tetap ada dan tetap
// ikut type-check. Menghidupkannya kembali cukup mengubah nilai di bawah menjadi `true`; tak ada
// file yang perlu dibuat ulang.
//
// Sebelum menyalakan lagi, periksa dua hal yang masih PLACEHOLDER: LEGAL_CONTACT_EMAIL &
// LEGAL_CONTACT_PHONE di atas, serta LEGAL_EFFECTIVE_DATE.
export const LEGAL_PAGES_ENABLED = false

// Tautan kebijakan pihak ketiga yang diproses datanya (wajib dicantumkan di kebijakan privasi)
export const THIRD_PARTY_LINKS = {
  xenditPrivacy: 'https://www.xendit.co/en/privacy-policy/',
  xenditTerms: 'https://www.xendit.co/en/terms-and-conditions/',
  mengantarPrivacy: 'https://www.mengantar.com/privacy-policy/',
} as const
