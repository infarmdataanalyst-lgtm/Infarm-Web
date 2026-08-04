// src/lib/format.ts
// Helper format angka/teks yang dipakai di seluruh project.

// Memformat angka menjadi string Rupiah, mis. 100000 -> "Rp100.000"
export function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString('id-ID')}`
}

// Memformat jumlah terjual jadi label ringkas untuk kartu produk, mis. 523 -> "500+", 87 -> "80+",
// 8 -> "8". Angka < 10 tampil apa adanya; ≥ 10 dibulatkan turun ke kelipatan "bulat" lalu diberi "+".
// ≥ 1000 memakai satuan "rb" (mis. 1500 -> "1,5rb+"). Mengembalikan '' bila 0 (kartu sembunyikan).
export function formatSold(count: number): string {
  if (count <= 0) return ''
  if (count < 10) return String(count)
  if (count < 1000) return `${Math.floor(count / 10) * 10}+`
  // ribuan: 1 desimal, koma ID, buang ',0'
  const rb = Math.floor(count / 100) / 10 // mis. 1523 -> 15.2 -> 1.5 (rb)
  return `${rb.toFixed(1).replace('.', ',').replace(',0', '')}rb+`
}
