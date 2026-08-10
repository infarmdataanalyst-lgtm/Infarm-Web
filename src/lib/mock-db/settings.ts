// src/lib/mock-db/settings.ts
// Akses tabel `store_settings` (key-value) — SERVER ONLY (createAdminClient / service_role).
// Tabel ini RLS-aktif tanpa policy publik, jadi TIDAK bisa dibaca langsung dari browser;
// storefront mengambil nilainya lewat endpoint publik read-only (/api/settings/min-order).

import { createAdminClient } from '@/lib/supabase/server'

// Kunci setting yang dikenal aplikasi
export const MIN_ORDER_AMOUNT_KEY = 'min_order_amount'

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
