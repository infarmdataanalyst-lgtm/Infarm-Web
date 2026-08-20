// src/lib/courier-logo.ts
// SATU PINTU pemetaan kurir → file logo di public/images/couriers/.
// Modul MURNI (tanpa akses DB/fetch) supaya bisa dipakai client maupun server component.
//
// ── Kenapa dinormalkan, bukan dicocokkan apa adanya ──
// Nama kurir yang sama datang dalam TIGA bentuk berbeda tergantung sumbernya:
//   - `courier.id`        dari respons cek ongkir Mengantar → 'JT', 'SiCepat', 'JNECargo'
//   - `courier.name`      label tampilan kita                → 'J&T', 'SiCepat Cargo'
//   - `orders.nama_ekspedisi` yang tersimpan di DB           → 'J&T'
// Ketiganya harus menghasilkan logo yang sama, jadi kuncinya dinormalkan lebih dulu:
// huruf besar + buang semua yang bukan huruf/angka ('J&T' dan 'JT' sama-sama jadi 'JT').

// Kunci = kode kurir yang SUDAH dinormalkan. Nilai = nama file di public/images/couriers/.
//
// PENTING: entri hanya boleh ada bila filenya benar-benar ada. Menambah kurir baru = taruh
// filenya lalu tambahkan satu baris di sini; tak ada kode lain yang perlu disentuh.
const COURIER_LOGOS: Record<string, string> = {
  JT: 'jt.png', // J&T Express — satu-satunya kurir yang ditawarkan saat ini
}

// Menormalkan nama/kode kurir jadi kunci pencarian.
// 'J&T' → 'JT', 'SiCepat Cargo' → 'SICEPATCARGO', ' jne ' → 'JNE'.
export function normalizeCourierKey(idOrName: string): string {
  return idOrName.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Path logo kurir, atau null bila belum tersedia (pemanggil menampilkan ikon truk generik).
// Menerima `courier.id`, `courier.name`, maupun `orders.nama_ekspedisi`.
export function courierLogoSrc(idOrName: string | null | undefined): string | null {
  if (!idOrName) return null
  const file = COURIER_LOGOS[normalizeCourierKey(idOrName)]
  return file ? `/images/couriers/${file}` : null
}
