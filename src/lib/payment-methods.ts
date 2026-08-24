// src/lib/payment-methods.ts
// SATU PINTU daftar metode pembayaran yang DITAMPILKAN di halaman checkout.
// Modul MURNI (tanpa DB/fetch/env) supaya bisa dipakai client maupun server component.
//
// ── Kenapa hanya informasi, bukan pilihan ──
// Pemilihan metode terjadi di halaman Xendit, bukan di sini. Menyediakan pemilih di checkout
// berarti pembeli memilih dua kali — sekali di sini, sekali lagi di Xendit — dan yang pertama
// tidak berpengaruh apa pun. Daftar ini hanya menjawab "nanti bisa bayar pakai apa saja".
//
// ⚠️ Daftar ini TIDAK dibaca dari Xendit. Ia salinan manual dari metode yang aktif di akun
// (lihat `available_banks` / `available_ewallets` / `available_qr_codes` /
// `available_direct_debits` pada respons pembuatan invoice). Kalau metode di akun Xendit
// diubah, daftar di sini WAJIB ikut diperbarui — kalau tidak, pembeli dijanjikan metode yang tak
// ada, atau tak diberi tahu metode yang sebenarnya tersedia.

// Satu logo penyedia pembayaran.
export type PaymentLogo = {
  // Nama file (tanpa ekstensi) di public/images/payments/, mis. 'dana' → dana.png
  slug: string
  // Nama untuk alt text & teks cadangan bila filenya belum ada
  label: string
}

// Satu kelompok metode pembayaran.
//
// TANPA field deskripsi: logonya sudah menjelaskan isinya lebih cepat daripada kalimat, dan empat
// paragraf berderet membuat seksi ini terbaca seperti dokumen alih-alih daftar.
export type PaymentMethodGroup = {
  id: string
  title: string
  logos: PaymentLogo[]
  // Keterangan tambahan bila logonya sengaja tidak ditampilkan semua (mis. bank VA terlalu banyak).
  more?: string
}

export const PAYMENT_METHOD_GROUPS: PaymentMethodGroup[] = [
  {
    id: 'va',
    title: 'Virtual Account',
    logos: [
      { slug: 'bca', label: 'BCA' },
      { slug: 'mandiri', label: 'Mandiri' },
      { slug: 'bri', label: 'BRI' },
      { slug: 'bni', label: 'BNI' },
    ],
    more: '& bank lainnya',
  },
  {
    id: 'ewallet',
    title: 'E-Wallet',
    logos: [
      { slug: 'dana', label: 'DANA' },
      { slug: 'ovo', label: 'OVO' },
      { slug: 'shopeepay', label: 'ShopeePay' },
    ],
  },
  {
    id: 'qris',
    title: 'QRIS',
    logos: [{ slug: 'qris', label: 'QRIS' }],
  },
  {
    id: 'direct-debit',
    title: 'Debit',
    // TIDAK diberi `more`. Respons invoice akun ini hanya memuat DD_BRI & DD_MANDIRI, jadi
    // menulis "& bank lainnya" seperti pada Virtual Account akan menjanjikan yang tak ada.
    logos: [
      { slug: 'bri', label: 'BRI' },
      { slug: 'mandiri', label: 'Mandiri' },
    ],
  },
]

// Path file logo penyedia pembayaran.
//
// TIDAK memeriksa keberadaan file — pemeriksaan itu butuh akses filesystem (server-only) sementara
// daftar ini dirender di komponen klien. Komponen `PaymentLogo` yang menangani file yang belum ada
// lewat `onError`, pola sama dengan `CourierLogo`.
export function paymentLogoSrc(slug: string): string {
  return `/images/payments/${slug}.png`
}
