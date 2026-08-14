// src/lib/mock-db/settings.ts
// Akses tabel `store_settings` (key-value) — SERVER ONLY (createAdminClient / service_role).
// Tabel ini RLS-aktif tanpa policy publik, jadi TIDAK bisa dibaca langsung dari browser;
// storefront mengambil nilainya lewat endpoint publik read-only (/api/settings/min-order).

import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@/lib/product-validation'

// Kunci setting yang dikenal aplikasi
export const MIN_ORDER_AMOUNT_KEY = 'min_order_amount'
export const WAREHOUSE_MODE_KEY = 'warehouse_mode'
export const LOW_STOCK_THRESHOLD_KEY = 'low_stock_threshold'
export const STORE_NAME_KEY = 'store_name'
export const STORE_DESCRIPTION_KEY = 'store_description'
// Kapan seorang admin terakhir membuka panel notifikasi. Satu baris PER ADMIN, karena
// "sudah dibaca" itu milik orang, bukan milik toko — kalau satu kunci dipakai bersama,
// admin A membuka panel dan lencana admin B ikut hilang.
export const NOTIF_LAST_SEEN_PREFIX = 'notif_last_seen:'

// === Akses generik ===

// Membaca satu setting mentah. null bila tak ada / tabel belum di-migrate / gangguan koneksi —
// pemanggil WAJIB punya nilai cadangan sendiri (jangan biarkan gangguan setting mematikan fitur).
export async function getSetting(key: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('store_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    console.error(`Gagal membaca setting ${key}:`, error.message)
    return null
  }
  const value = data?.value
  return typeof value === 'string' && value.length > 0 ? value : null
}

// Menyimpan satu setting (upsert by key). Melempar Error bila gagal agar route bisa membalas 500 —
// admin harus tahu kalau perubahannya TIDAK tersimpan.
export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('store_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) throw new Error(`Gagal menyimpan setting ${key}: ${error.message}`)
}

// Nilai cadangan bila tabel belum di-migrate / baris terhapus / nilai tak valid.
// Dipilih di atas batas minimum Xendit (±Rp10.000) agar order tetap bisa dibuatkan invoice.
export const DEFAULT_MIN_ORDER_AMOUNT = 15000

// Batas atas yang wajar untuk input admin — mencegah salah ketik (mis. 15000000) mengunci toko.
export const MAX_MIN_ORDER_AMOUNT = 1_000_000

// Membaca minimum total belanja (rupiah, INTEGER). Selalu mengembalikan angka valid:
// nilai TEXT di DB di-cast dan diverifikasi; gagal apa pun → DEFAULT_MIN_ORDER_AMOUNT.
export async function getMinOrderAmount(): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('store_settings')
    .select('value')
    .eq('key', MIN_ORDER_AMOUNT_KEY)
    .maybeSingle()

  if (error) {
    // Tabel belum di-migrate atau gangguan koneksi → jangan sampai checkout ikut mati
    console.error('Gagal membaca min_order_amount:', error.message)
    return DEFAULT_MIN_ORDER_AMOUNT
  }

  const parsed = Number.parseInt(String(data?.value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_ORDER_AMOUNT
}

// Menyimpan minimum total belanja (rupiah). Nilai di-clamp ke rentang wajar sebelum ditulis.
// Mengembalikan nilai yang benar-benar tersimpan.
export async function setMinOrderAmount(amount: number): Promise<number> {
  const safe = Math.min(MAX_MIN_ORDER_AMOUNT, Math.max(0, Math.floor(amount)))
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { key: MIN_ORDER_AMOUNT_KEY, value: String(safe), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

  if (error) throw new Error(`Gagal menyimpan pengaturan: ${error.message}`)
  return safe
}

// === Ambang stok menipis ===

// Batas atas yang wajar untuk input admin. Ambang setinggi stok maksimum (999.999) akan menandai
// SELURUH katalog "menipis" sehingga peringatannya kehilangan arti.
export const MAX_LOW_STOCK_THRESHOLD = 1_000

// Membaca ambang "stok menipis" (produk dianggap menipis bila stok efektif < angka ini).
// Selalu mengembalikan angka valid — gangguan setting tidak boleh mematikan peringatan stok.
export async function getLowStockThreshold(): Promise<number> {
  const raw = await getSetting(LOW_STOCK_THRESHOLD_KEY)
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LOW_STOCK_THRESHOLD) {
    return DEFAULT_LOW_STOCK_THRESHOLD
  }
  return parsed
}

// Menyimpan ambang "stok menipis". Nilai di-clamp ke rentang wajar; mengembalikan nilai tersimpan.
export async function setLowStockThreshold(value: number): Promise<number> {
  const safe = Math.min(MAX_LOW_STOCK_THRESHOLD, Math.max(1, Math.floor(value)))
  await setSetting(LOW_STOCK_THRESHOLD_KEY, String(safe))
  return safe
}

// === Profil toko ===

export const STORE_NAME_MAX = 100
export const STORE_DESCRIPTION_MAX = 500
export const DEFAULT_STORE_NAME = 'infarm'

export type StoreProfile = { name: string; description: string }

// Membaca profil toko (nama & deskripsi). Nama kosong → DEFAULT_STORE_NAME agar UI tak pernah
// menampilkan judul kosong.
export async function getStoreProfile(): Promise<StoreProfile> {
  const [name, description] = await Promise.all([
    getSetting(STORE_NAME_KEY),
    getSetting(STORE_DESCRIPTION_KEY),
  ])
  return { name: name ?? DEFAULT_STORE_NAME, description: description ?? '' }
}

// Menyimpan profil toko. Nilai sudah divalidasi pemanggil; di sini hanya dipotong ke batas panjang
// sebagai jaring pengaman terakhir sebelum menyentuh DB.
export async function setStoreProfile(profile: StoreProfile): Promise<StoreProfile> {
  const safe: StoreProfile = {
    name: profile.name.trim().slice(0, STORE_NAME_MAX),
    description: profile.description.trim().slice(0, STORE_DESCRIPTION_MAX),
  }
  // Berurutan, bukan paralel: dua upsert ke tabel yang sama sekaligus tak memberi keuntungan
  // berarti dan menyulitkan menentukan kunci mana yang gagal bila error.
  await setSetting(STORE_NAME_KEY, safe.name)
  await setSetting(STORE_DESCRIPTION_KEY, safe.description)
  return safe
}

// === Penanda "notifikasi sudah dibaca" per admin ===

// Waktu terakhir admin membuka panel notifikasi (ISO). null = belum pernah membuka sama sekali,
// pemanggil memperlakukan seluruh notifikasi sebagai belum dibaca.
export async function getNotifLastSeen(adminId: string): Promise<string | null> {
  return getSetting(`${NOTIF_LAST_SEEN_PREFIX}${adminId}`)
}

// Menandai seluruh notifikasi sampai waktu `at` sebagai sudah dibaca oleh admin tersebut.
export async function setNotifLastSeen(adminId: string, at: string): Promise<void> {
  await setSetting(`${NOTIF_LAST_SEEN_PREFIX}${adminId}`, at)
}
