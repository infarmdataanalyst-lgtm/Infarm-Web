// src/lib/order-token.ts
// Token keamanan untuk tautan pembatalan pesanan Guest.
// Karena tidak ada login, tautan pembatalan diamankan dengan token HMAC yang diturunkan dari
// orderId + secret server. Hanya pemegang tautan resmi (mis. dari halaman Order Confirmed) yang
// bisa membuka & membatalkan pesanannya — orderId saja tidak cukup.
//
// SERVER-ONLY: memakai node:crypto & secret. Jangan diimpor dari komponen 'use client'.
//
// ── Yang berubah pada 2026-09-01 (menutup temuan SEC-006) ──
//
// 1. FALLBACK SECRET DIHAPUS. Dulu berkas ini memakai `process.env.ORDER_CANCEL_SECRET ??
//    'infarm-dev-cancel-secret'`. Bila env produksi lupa diisi, kunci penandatangan menjadi string
//    yang tertulis di repo — siapa pun yang membacanya bisa menghitung token pembatalan untuk
//    SEMBARANG nomor pesanan, lalu membatalkan pesanan orang lain secara massal sekaligus memicu
//    pengembalian stok. Kini secret diambil lewat requireServerSecret() yang MENOLAK berjalan di
//    produksi bila env kosong.
//
// 2. TOKEN KINI PUNYA MASA BERLAKU DAN NONCE. Versi lama murni `HMAC(orderId)`: deterministik,
//    berlaku selamanya, dan satu-satunya cara mencabutnya adalah merotasi secret — yang sekaligus
//    mematikan token semua pesanan lain. Antarmuka bahkan sudah terlanjur mengklaim tautannya
//    "kedaluwarsa" padahal tidak. Sekarang masa berlaku ikut ditandatangani, jadi tautan yang
//    bocor (riwayat browser, tangkapan layar, tautan yang diteruskan) berhenti berbahaya dengan
//    sendirinya.
//
// ── Kenapa memutus kompatibilitas token lama ──
// Token TIDAK PERNAH disimpan: tak ada kolomnya di database, dan pengiriman email belum aktif.
// Satu-satunya tempat token dibuat adalah halaman sukses checkout, dan ia dibuat ulang tiap kali
// halaman itu dirender. Jadi praktis tak ada token lama yang beredar. Menerima format lama demi
// keamanan-mundur justru mempertahankan persis lubang yang sedang ditutup (token abadi), maka
// format lama sengaja ditolak. Pembeli yang menyimpan tautan sangat lama tetap punya jalan lain:
// membatalkan lewat /cancel-order memakai nomor teleponnya.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { requireServerSecret } from '@/lib/server-secret'

const SECRET_ENV = 'ORDER_CANCEL_SECRET'

// Masa berlaku tautan pembatalan.
//
// 7 hari dipilih sebagai kompromi: cukup lama untuk pembeli yang baru membuka emailnya beberapa
// hari kemudian, cukup pendek agar tautan yang bocor tidak menjadi kunci abadi. Pembatalan sendiri
// hanya relevan selama pesanan belum dikirim, dan sisi server tetap memvalidasi status pesanan
// secara terpisah — jadi masa berlaku ini adalah lapis tambahan, bukan satu-satunya penjaga.
const TTL_MS = 7 * 24 * 60 * 60 * 1000

// Panjang potongan tanda tangan yang dibawa token. 32 hex = 128 bit, jauh di atas batas praktis
// tebakan acak, dan menjaga tautan tetap pendek.
const SIG_LENGTH = 32

// Nonce membuat dua token untuk pesanan yang sama tidak pernah identik. Gunanya bukan kerahasiaan
// (isinya memang tampak di tautan) melainkan agar setiap tautan bisa dibedakan satu sama lain.
const NONCE_BYTES = 6

function tandaTangan(orderId: string, kedaluwarsa: string, nonce: string): string {
  return createHmac('sha256', requireServerSecret(SECRET_ENV))
    .update(`${orderId}.${kedaluwarsa}.${nonce}`)
    .digest('hex')
    .slice(0, SIG_LENGTH)
}

// Membuat token pembatalan untuk sebuah orderId (dipakai saat menyusun tautan).
//
// Bentuk: `<kedaluwarsa-base36>.<nonce-hex>.<tanda-tangan-hex>`. Masa berlaku sengaja ikut
// DITANDATANGANI, bukan sekadar dititipkan di tautan — kalau tidak, siapa pun bisa memperpanjang
// sendiri tautannya hanya dengan mengubah angka itu.
export function generateCancelToken(orderId: string): string {
  const kedaluwarsa = (Date.now() + TTL_MS).toString(36)
  const nonce = randomBytes(NONCE_BYTES).toString('hex')
  return `${kedaluwarsa}.${nonce}.${tandaTangan(orderId, kedaluwarsa, nonce)}`
}

// Memverifikasi token terhadap orderId. Mengembalikan false bila bentuknya salah, sudah lewat masa
// berlaku, atau tanda tangannya tidak cocok.
//
// Perbandingan tanda tangan memakai waktu-konstan agar aman dari timing attack. Pemeriksaan masa
// berlaku dilakukan LEBIH DULU: token kedaluwarsa ditolak tanpa perlu menghitung HMAC sama sekali.
export function verifyCancelToken(orderId: string, token: string): boolean {
  if (typeof token !== 'string') return false

  const bagian = token.split('.')
  // Token format LAMA (satu potong hex tanpa masa berlaku) jatuh ke sini dan ditolak — disengaja,
  // lihat catatan "memutus kompatibilitas" di kepala berkas.
  if (bagian.length !== 3) return false

  const [kedaluwarsa, nonce, sig] = bagian as [string, string, string]
  if (!kedaluwarsa || !nonce || !sig) return false

  const batas = Number.parseInt(kedaluwarsa, 36)
  if (!Number.isFinite(batas) || batas <= Date.now()) return false

  const diharapkan = tandaTangan(orderId, kedaluwarsa, nonce)
  if (sig.length !== diharapkan.length) return false

  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(diharapkan))
  } catch {
    return false
  }
}
