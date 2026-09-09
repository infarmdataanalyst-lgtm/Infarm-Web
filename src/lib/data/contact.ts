// src/lib/data/contact.ts
// Kanal kontak CS yang dipakai lintas komponen (tombol WhatsApp mengambang, halaman maintenance,
// pengajuan pembatalan). Satu sumber agar penggantian nomor cukup di satu tempat.

// Nomor WhatsApp CS, format internasional TANPA tanda plus dan tanpa nol di depan.
// Contoh untuk 0812-3456-7890 → '6281234567890'.
//
// KOSONG = belum dikonfigurasi. Sengaja kosong, bukan diisi nomor contoh: nomor dummy yang
// terlihat asli akan diklik pembeli sungguhan dan mendarat entah ke siapa.
export const WHATSAPP_CS_NUMBER = ''

// TODO(infarm): isi WHATSAPP_CS_NUMBER di atas. Selama kosong, seluruh tautan WhatsApp menjadi
// null dan pemanggilnya WAJIB menyediakan jalan lain (teks instruksi, bukan tombol mati).
export const WHATSAPP_CS_LINK: string = waLink('') ?? '/404'

// Menyusun tautan wa.me dengan pesan yang sudah terisi.
// Mengembalikan null bila nomor belum dikonfigurasi — pemanggil memutuskan apa yang ditampilkan
// sebagai gantinya. Sengaja null, bukan '#' atau '/404', supaya tombol mati tak pernah lolos ke
// layar pembeli tanpa disadari.
export function waLink(pesan: string): string | null {
  if (!WHATSAPP_CS_NUMBER) return null
  const teks = pesan ? `?text=${encodeURIComponent(pesan)}` : ''
  return `https://wa.me/${WHATSAPP_CS_NUMBER}${teks}`
}

// Tautan pengajuan pembatalan: pesan sudah lengkap dengan nomor invoice, pembeli tinggal menekan
// kirim. Nomor invoice WAJIB ikut — tanpa itu admin harus bertanya balik, dan pengajuan yang
// butuh dua percakapan sering berhenti di percakapan pertama.
export function waCancelRequestLink(invoice: string): string | null {
  const nomor = invoice.startsWith('#') ? invoice : `#${invoice}`
  return waLink(
    `Halo Admin Infarm, saya ingin mengajukan pembatalan pesanan ${nomor}.\n\n` +
      `Alasan: (mohon isi alasan Anda)\n\n` +
      `Terima kasih.`,
  )
}
