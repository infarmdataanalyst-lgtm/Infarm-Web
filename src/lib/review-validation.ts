// src/lib/review-validation.ts
// Batas & validasi bersama untuk isi ulasan produk, dipakai server (tiga endpoint submit) maupun
// client (halaman /review). Satu sumber angka supaya batas yang ditampilkan ke pengguna dan batas
// yang benar-benar ditegakkan server tidak pernah berbeda.
//
// Kenapa ada (menutup bagian batas panjang pada SEC-042): sebelum ini TIDAK ADA endpoint submit
// ulasan yang membatasi panjang `comment` maupun `authorName`. Rendering ulasan sudah aman dari
// XSS, jadi ini bukan celah injeksi — yang terbuka adalah penyimpanan: satu ulasan sah bisa
// membawa payload teks sebesar apa pun ke kolom `comment`, lalu ikut terkirim ke SETIAP pengunjung
// halaman produk itu. Batasnya sengaja longgar; yang ditolak hanya yang jelas bukan ulasan.

// Panjang maksimum komentar ulasan. 2.000 karakter kira-kira 300 kata — jauh di atas ulasan
// terpanjang yang masuk akal, tapi tetap memberi atap yang pasti. Angka ini sengaja disamakan
// dengan DESC_MAX pada product-validation agar batas teks panjang di project ini konsisten.
export const REVIEW_COMMENT_MAX = 2000

// Panjang maksimum nama penulis. Server-lah yang mengisi nama ini dari pesanan terverifikasi
// (lihat SEC-007 & SEC-041), jadi batas ini berperan sebagai jaring pengaman terakhir sebelum
// menulis ke DB — bukan validasi masukan pengguna.
export const REVIEW_AUTHOR_NAME_MAX = 100

// Pesan penolakan tunggal untuk komentar yang melewati batas — dipakai ketiga endpoint submit
// supaya pengguna menerima kalimat yang sama lewat jalur mana pun ulasannya dikirim.
export const REVIEW_COMMENT_TOO_LONG = `Komentar terlalu panjang (maksimal ${REVIEW_COMMENT_MAX} karakter).`

// Memotong nama penulis ke batas aman. Dipakai server SETELAH nama diambil dari pesanan —
// memotong, bukan menolak, karena nama itu bukan masukan pengguna dan menolaknya berarti
// menggagalkan ulasan yang sah hanya karena data lama kepanjangan.
export function clampAuthorName(name: string): string {
  return name.length > REVIEW_AUTHOR_NAME_MAX ? name.slice(0, REVIEW_AUTHOR_NAME_MAX) : name
}
