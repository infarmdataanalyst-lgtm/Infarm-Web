// src/lib/mask.ts
// Samarkan (mask) bagian tengah data pribadi untuk ditampilkan di halaman publik.
// Dipakai halaman Lacak Pesanan (/track) yang bisa diakses hanya dengan nomor invoice —
// masking mengurangi keparahan kebocoran PII bila nomor invoice dienumerasi (lihat S-2 di
// docs/security/). CATATAN: masking BUKAN kontrol akses; proteksi penuh butuh gating verifikasi.

// Ganti bagian tengah string dengan '*', sisakan `keepStart` karakter awal & `keepEnd` akhir.
// Bila string terlalu pendek (≤ keepStart+keepEnd), seluruhnya disamarkan.
export function maskMiddle(value: string, keepStart: number, keepEnd: number, minStars = 2): string {
  const s = value.trim()
  if (s.length <= keepStart + keepEnd) return '*'.repeat(Math.max(minStars, s.length))
  const stars = '*'.repeat(Math.max(minStars, s.length - keepStart - keepEnd))
  return s.slice(0, keepStart) + stars + s.slice(s.length - keepEnd)
}

// Samarkan nomor HP, pertahankan 4 digit awal (operator) & 4 digit akhir.
// Contoh: 081234567890 → 0812****7890
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return maskMiddle(digits, 4, 4)
}

// Samarkan nama per kata: pertahankan huruf pertama & terakhir tiap kata.
// Contoh: "Fiqih Pavita" → "Fi**h Pa**ta"
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w[0] + '*' : maskMiddle(w, 1, 1)))
    .join(' ')
}

// Samarkan detail jalan/nomor rumah (teks bebas paling sensitif), pertahankan sedikit awalan+akhiran.
// Region (kelurahan/kecamatan/kota/provinsi) TIDAK disamarkan agar user tetap bisa mengenali pesanannya.
// Contoh: "Jl. Merpati No. 12 RT 03" → "Jl. M••••••••••03"
export function maskStreet(street: string): string {
  const s = street.trim()
  if (!s) return s
  return maskMiddle(s, 5, 2)
}
