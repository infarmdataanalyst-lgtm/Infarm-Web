// src/types/promotion.ts
// Tipe data promo untuk fitur "Promosi" di OMS. Dipetakan dari tabel public.promotions (Supabase).

// Tipe hadiah promo
export type PromotionType = 'free_shipping' | 'free_product' | 'discount_nominal' | 'discount_percent'

// Label tampilan tiap tipe hadiah (dipakai badge tabel & dropdown form)
export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  free_shipping: 'Gratis Ongkir',
  free_product: 'Gratis Produk',
  discount_nominal: 'Diskon Nominal',
  discount_percent: 'Diskon Persen',
}

// Promo lengkap yang disimpan & ditampilkan di OMS.
export type Promotion = {
  id: string
  name: string
  type: PromotionType
  minPurchase: number // minimal pembelian (rupiah)
  freeProductId: string | null // untuk free_product: id produk hadiah (snapshot, tanpa FK)
  freeProductName: string | null // snapshot nama produk hadiah
  discountValue: number | null // discount_nominal → rupiah; discount_percent → persen (1-100)
  startAt: string | null // ISO; null = tak terbatas
  endAt: string | null // ISO; null = tak terbatas
  progressMessage: string // pesan progres di keranjang (boleh memuat token {sisa})
  isActive: boolean
  createdAt: string // ISO date, untuk urutan terbaru
}

// Payload dari form OMS untuk membuat / memperbarui promo (sebelum disimpan).
export type PromotionInput = {
  name: string
  type: PromotionType
  minPurchase: number
  freeProductId: string | null
  freeProductName: string | null
  discountValue: number | null
  startAt: string | null
  endAt: string | null
  progressMessage: string
  isActive: boolean
}

// === Tanggal promo dalam WIB ===
//
// Admin memilih TANGGAL (tanpa jam) di formulir. Dulu tanggal itu dikirim sebagai
// "2026-09-26T00:00:00" TANPA zona waktu, dan Postgres (sesi UTC) menyimpannya sebagai 00.00 UTC =
// 07.00 WIB. Promo "mulai 26 Sep" baru aktif jam 7 pagi, dan promo "berakhir 30 Sep" masih berlaku
// sampai 1 Okt 06.59 WIB. Toko & pembelinya di WIB, jadi batasnya ditulis eksplisit dalam +07:00.
const WIB_OFFSET = '+07:00'
const WIB_TIMEZONE = 'Asia/Jakarta'

// "2026-09-26" → awal hari itu di WIB (00.00.00 WIB).
export function promoStartIso(date: string): string {
  return `${date}T00:00:00${WIB_OFFSET}`
}

// "2026-09-30" → akhir hari itu di WIB (23.59.59 WIB).
export function promoEndIso(date: string): string {
  return `${date}T23:59:59${WIB_OFFSET}`
}

// ISO dari DB (UTC) → "YYYY-MM-DD" menurut kalender WIB, untuk isian <input type="date">.
// Dulu memakai iso.slice(0, 10), yang membaca tanggal UTC — 23.59 WIB tanggal 30 tersimpan sebagai
// 16.59 UTC tanggal 30 (benar), tapi 00.00 WIB tanggal 26 tersimpan sebagai 17.00 UTC tanggal 25.
export function toWibDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: WIB_TIMEZONE }).format(d)
}

// Tanggal hari ini menurut WIB ("YYYY-MM-DD") — dasar aturan "tanggal mulai tak boleh lewat".
export function todayWib(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: WIB_TIMEZONE }).format(now)
}

// Promo TERJADWAL: aktif, tapi tanggal mulainya belum tiba. Belum ditawarkan ke pembeli
// (/api/promotions/active menyaringnya), jadi OMS harus membedakannya dari promo yang berjalan —
// tanpa itu admin mengira promonya rusak karena tak muncul di keranjang.
export function isPromotionScheduled(startAt: string | null, nowMs: number): boolean {
  if (!startAt) return false
  return new Date(startAt).getTime() > nowMs
}

// Promo kedaluwarsa bila endAt terisi & sudah lewat dari "sekarang".
// Status Kedaluwarsa TIDAK disimpan di DB — dihitung di frontend (nowMs dari client).
export function isPromotionExpired(endAt: string | null, nowMs: number): boolean {
  if (!endAt) return false
  return new Date(endAt).getTime() < nowMs
}
