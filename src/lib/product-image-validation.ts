// src/lib/product-image-validation.ts
// Validasi data-URL gambar produk di SISI SERVER (menutup SEC-019).
//
// SERVER-ONLY: memakai Buffer untuk memeriksa magic bytes. Jangan impor dari komponen 'use client'
// — batas untuk client sudah ada di @/lib/product-validation (validateImageFile), yang bekerja
// pada objek File dan tidak butuh Buffer.
//
// Kenapa terpisah dari product-validation.ts: berkas itu diimpor komponen client, jadi ia tak boleh
// menyeret Buffer maupun logika yang hanya masuk akal di server.
//
// ── Kenapa validasi ini ada ──
// MAX_IMAGE_BYTES dan ACCEPTED_IMAGE_TYPES sudah lama terdefinisi, tetapi TIDAK PERNAH dipanggil
// dari route create maupun update — sehingga ukuran dan tipe gambar praktis hanya diperiksa di
// browser, dan browser tak perlu dilibatkan sama sekali oleh siapa pun yang memanggil endpointnya
// langsung. Tiga hal yang ditegakkan di sini:
//
//   1. TIPE yang diklaim harus ada di whitelist. Nilai mime pada data-URL adalah klaim client, dan
//      dulu ia dipakai apa adanya sebagai contentType saat mengunggah ke Storage PUBLIK — artinya
//      sebuah berkas bisa tersaji dari domain kita dengan tipe pilihan pengunggahnya.
//   2. ISI harus cocok dengan tipe yang diklaim, diperiksa lewat magic bytes. Whitelist saja tak
//      cukup: pengunggah tinggal menulis "image/png" di depan byte apa pun.
//   3. UKURAN diperkirakan dari panjang string base64 SEBELUM di-decode. Memeriksa sesudah decode
//      berarti alokasi besarnya sudah terjadi — persis yang ingin dihindari.

// Batas ukuran per berkas. Nilainya sengaja dikunci sama dengan MAX_IMAGE_BYTES di
// @/lib/product-validation; dituliskan ulang di sini agar modul server ini tak perlu mengimpor
// modul yang dipakai client.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

// Tipe yang diterima → ekstensi berkasnya di Storage. Kunci objek ini SEKALIGUS whitelist-nya.
export const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Tanda tangan byte awal tiap format yang diterima.
const MAGIC_BYTES: Record<string, (buf: Buffer) => boolean> = {
  // JPEG selalu diawali FF D8 FF
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  'image/png': (b) =>
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  // WebP: "RIFF" .... "WEBP" (byte 8-11)
  'image/webp': (b) =>
    b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
}

// Perkiraan ukuran hasil decode dari panjang string base64, tanpa mendekode apa pun.
// 4 karakter base64 = 3 byte; tiap '=' di ujung mengurangi 1 byte.
export function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

// Memvalidasi SATU nilai gambar. Mengembalikan pesan error (untuk ditampilkan ke admin) atau null
// bila lolos.
//
// Nilai yang BUKAN data-URL (URL Storage yang sudah tersimpan, placeholder, string kosong)
// dilewatkan begitu saja: fungsi ini hanya mengurus berkas yang baru diunggah. Ini yang membuatnya
// aman dipanggil pada PATCH parsial, yang kerap mengirim ulang URL lama apa adanya.
export function validateImageValue(value: string): string | null {
  if (!value || !value.startsWith('data:')) return null

  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return 'Format gambar tidak dikenali. Unggah ulang file JPG, PNG, atau WebP.'

  const mime = match[1]
  const base64 = match[2]

  if (!IMAGE_MIME_EXT[mime]) {
    return `Tipe gambar ${mime} tidak diizinkan. Gunakan JPG, PNG, atau WebP.`
  }

  const bytes = estimateBase64Bytes(base64)
  if (bytes > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0)
    return `Ukuran gambar melebihi ${mb}MB. Perkecil dulu lalu unggah ulang.`
  }

  // Baru di sini di-decode — sesudah ukurannya dipastikan wajar.
  if (!MAGIC_BYTES[mime](Buffer.from(base64, 'base64'))) {
    return `Isi berkas tidak cocok dengan tipe ${mime}. File-nya kemungkinan bukan gambar.`
  }

  return null
}

// Memvalidasi foto utama + seluruh galeri sekaligus. Mengembalikan pesan error pertama, atau null.
export function validateProductImages(input: {
  imageUrl?: unknown
  images?: unknown
}): string | null {
  if (typeof input.imageUrl === 'string') {
    const err = validateImageValue(input.imageUrl)
    if (err) return err
  }
  if (Array.isArray(input.images)) {
    for (const [i, img] of input.images.entries()) {
      if (typeof img !== 'string') return `Gambar ke-${i + 1} tidak valid.`
      const err = validateImageValue(img)
      if (err) return `Gambar ke-${i + 1}: ${err}`
    }
  }
  return null
}
