// src/lib/data/contact.ts
// Kanal kontak CS yang dipakai lintas komponen (tombol WhatsApp mengambang, halaman maintenance).
// Satu sumber agar penggantian nomor cukup di satu tempat.

// TODO(infarm): ganti dengan link WhatsApp CS resmi setelah tersedia.
// Format nantinya: https://wa.me/62xxxxxxxxxx?text=Halo%2C%20saya%20ingin%20bertanya%20tentang%20produk
// Sementara diarahkan ke halaman 404 (JANGAN pakai nomor dummy yang terlihat asli).
export const WHATSAPP_CS_LINK = '/404'
