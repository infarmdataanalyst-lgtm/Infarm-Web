// src/lib/shipping-weight.ts
// SATU PINTU perhitungan berat kirim: gram (cara kita menyimpan) → kilogram (yang diminta Mengantar).
// Fungsi MURNI, tanpa akses DB — dipakai bersama oleh checkout (client) dan API create order (server),
// supaya angka yang dilihat buyer dan angka yang diverifikasi server dihitung oleh kode yang sama.
//
// ── Kenapa gram di DB, kg di API ──
// Berat disimpan INTEGER gram mengikuti konvensi harga project (rupiah bulat, tak ada desimal) —
// integer bebas dari galat pembulatan float. Mengantar (allEstimatePublic) meminta parameter
// `weight` dalam KILOGRAM. Terbukti empiris: origin/destination sama, weight=1 → tarif JNE
// Rp30.000, weight=1000 → Rp30.000.000 (1000× lipat). Mengirim gram apa adanya = ongkir 1000×
// lebih mahal. Konversi WAJIB, dan hanya boleh terjadi di file ini.
//
// ── Pembulatan ──
// Mengantar menerima desimal dan membulatkan sendiri di sisi server, memakai aturan kurir
// Indonesia "lebih dari 0,3 kg dibulatkan ke atas": kg ditagih = ceil(kg − 0,3), minimum 1.
// Diverifikasi: 1,3 → 1 kg; 1,31 → 2 kg; 2,3 → 2 kg; 2,31 → 3 kg.
// Jadi kita mengirim kg PRESISI (mis. 1.75) dan TIDAK membulatkan sendiri — membulatkan ganda
// hanya akan membuat buyer dikenai satu kilogram ekstra yang tak pernah ditagih kurir.

// Berat cadangan per pcs bila produk belum diisi beratnya (kolom products.berat NULL).
// 1000 g dipilih supaya ongkir produk lama SAMA PERSIS dengan perilaku sebelum fitur ini ada
// (checkout dulu mengirim 1 kg per pcs). Menurunkannya akan membuat ongkir yang dikutip lebih
// murah dari tarif riil, dan selisihnya ditanggung toko sampai admin mengisi berat manual.
export const DEFAULT_WEIGHT_GRAM = 1000

// Batas berat per produk (gram) — cermin CHECK products_berat_check di DB.
export const WEIGHT_GRAM_MIN = 1
export const WEIGHT_GRAM_MAX = 1_000_000 // 1 ton; jaring pengaman salah input, bukan batas bisnis

// Berat minimum satu kiriman (kg). Mengantar sudah menerapkan minimum 1 kg sendiri, tapi
// `weight` harus > 0 (weight=0 membuat sebagian kurir membalas harga 0 → pilihan ongkir palsu).
export const MIN_SHIPPING_WEIGHT_KG = 1

// Satu baris yang ikut dikirim: butuh berat satuan + jumlah. `berat` boleh kosong (data lama).
export type WeighableItem = {
  quantity: number
  berat?: number | null
}

// Berat satuan yang dipakai perhitungan: nilai dari DB bila valid, sisanya cadangan.
// Nilai tak valid (0, negatif, desimal, NaN) diperlakukan sama dengan "belum diisi" — lebih baik
// memakai cadangan yang masuk akal daripada mengirim berat 0 kg ke Mengantar.
export function effectiveWeightGram(berat?: number | null): number {
  if (typeof berat !== 'number' || !Number.isFinite(berat)) return DEFAULT_WEIGHT_GRAM
  const g = Math.floor(berat)
  if (g < WEIGHT_GRAM_MIN) return DEFAULT_WEIGHT_GRAM
  return Math.min(g, WEIGHT_GRAM_MAX)
}

// Total berat seluruh item dalam GRAM: SUM(berat satuan × quantity).
// Item dengan quantity tak valid dilewati, tidak menggagalkan perhitungan — satu baris keranjang
// yang cacat tak boleh membuat buyer kehilangan seluruh pilihan ongkir.
export function totalWeightGram(items: WeighableItem[]): number {
  let total = 0
  for (const item of items) {
    const qty = Math.floor(item.quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue
    total += effectiveWeightGram(item.berat) * qty
  }
  return total
}

// Berat kirim dalam KILOGRAM, siap dikirim sebagai parameter `weight` ke Mengantar.
// Dibulatkan ke 2 desimal supaya kunci cache ongkir stabil (10 × 333 g = 3.33 kg, bukan
// 3.3299999999999996 yang akan menghasilkan kunci cache berbeda tiap perhitungan).
export function toShippingWeightKg(totalGram: number): number {
  const kg = totalGram / 1000
  const rounded = Math.round(kg * 100) / 100
  return Math.max(MIN_SHIPPING_WEIGHT_KG, rounded)
}

// Jalur pintas yang dipakai pemanggil: daftar item → berat kirim (kg).
export function shippingWeightKg(items: WeighableItem[]): number {
  return toShippingWeightKg(totalWeightGram(items))
}

// Apakah berat produk belum diisi admin → dasar badge peringatan di OMS.
// Sengaja berupa fungsi, bukan pembandingan `berat === 1000` di tiap halaman: menyamakan
// "belum diisi" dengan sebuah nilai konkret akan membadge produk yang beratnya memang 1 kg.
export function isWeightUnset(berat?: number | null): boolean {
  return typeof berat !== 'number' || !Number.isFinite(berat) || berat < WEIGHT_GRAM_MIN
}

// Format berat untuk TAMPILAN (tabel & form OMS): gram di bawah 1 kg, kilogram di atasnya.
// Mengembalikan null bila belum diisi supaya pemanggil menampilkan badge, bukan angka palsu.
export function formatWeight(berat?: number | null): string | null {
  if (isWeightUnset(berat)) return null
  const g = Math.floor(berat as number)
  if (g < 1000) return `${g} g`
  // Buang desimal nol agar 2000 g tampil "2 kg", bukan "2,00 kg"
  const kg = (g / 1000).toFixed(2).replace(/\.?0+$/, '')
  return `${kg.replace('.', ',')} kg`
}
