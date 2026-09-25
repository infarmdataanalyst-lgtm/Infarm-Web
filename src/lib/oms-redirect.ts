// src/lib/oms-redirect.ts
// Sanitasi tujuan redirect setelah login OMS. Modul ini SENGAJA tidak membawa rahasia apa pun,
// karena ia satu-satunya bagian dari alur sesi OMS yang memang perlu diimpor komponen client.
//
// ── Kenapa dipisah dari oms-auth.ts (menutup SEC-016) ──
// Halaman /oms/login berlabel 'use client' dan dulu mengimpor sanitizeOmsRedirect dari
// @/lib/oms-auth — modul yang di berkas yang sama juga mendefinisikan fungsi penanda tangan sesi
// admin (sign, createSessionToken, verifySessionToken) beserta pembacaan secret-nya. Satu import
// itu menarik seluruh modul pembawa rahasia ke dalam import graph bundle browser.
//
// Yang menahannya selama ini hanyalah tree-shaking: bundler PERLU membuktikan bagian bersecret itu
// tak terpakai lalu membuangnya. Itu bukan jaminan, hanya optimisasi yang kebetulan bekerja — dan
// satu perubahan kecil (mis. secret dibaca kembali di tingkat modul, bukan malas di dalam fungsi)
// sudah cukup untuk membuatnya berhenti bekerja, tanpa error, tanpa peringatan, tanpa ada yang
// menyadarinya sampai secret penanda tangan cookie admin terbaca dari bundle publik.
//
// Sekarang tidak ada lagi yang perlu dibuktikan bundler: berkas yang diimpor client memang tidak
// pernah memuat rahasia. oms-auth.ts sendiri kini menolak ikut ter-bundle ke client lewat
// `import 'server-only'`, jadi pelanggaran yang sama di kemudian hari GAGAL SAAT BUILD, bukan
// diam-diam lolos.

// Tujuan default setelah login bila tak ada ?redirect yang valid.
export const OMS_DEFAULT_REDIRECT = '/oms/dashboard'

// Pastikan target redirect aman: hanya path internal area dashboard OMS (cegah open redirect
// ke URL absolut / domain luar). Selain itu, kembalikan tujuan default.
export function sanitizeOmsRedirect(target: string | null | undefined): string {
  if (!target) return OMS_DEFAULT_REDIRECT
  if (target.startsWith('/oms/dashboard')) return target
  return OMS_DEFAULT_REDIRECT
}
