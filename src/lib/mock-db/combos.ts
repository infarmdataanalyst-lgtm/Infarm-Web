// src/lib/mock-db/combos.ts
// Akses data paket/combo (dikelola oleh OMS).
//
// ISOLASI: seluruh akses data combo HANYA lewat fungsi di file ini, sehingga pemanggil
// (API Route) tidak perlu tahu sumber datanya. Di-back oleh Supabase
// (tabel public.product_combos + public.product_combo_items).
//
// SERVER-ONLY. Dua jenis client, dan pemilihannya disengaja (SEC-031):
//   - readActiveCombosPublic() → createPublicClient() (anon, TUNDUK RLS). Khusus STOREFRONT.
//     Policy "Public dapat membaca combo aktif" (migration 20260907120000) hanya meloloskan
//     is_active = true, termasuk isi paketnya, jadi satu bug filter di kode tak lagi cukup untuk
//     membocorkan paket yang sengaja dinonaktifkan — database ikut menahan.
//   - Selebihnya → createAdminClient() (service_role, menembus RLS). OMS butuh baris NONAKTIF, dan
//     orders/create butuh baca otoritatif yang tak bergantung pada policy.
// Jangan diimpor dari komponen 'use client'.

import { createAdminClient, createPublicClient } from '@/lib/supabase/server'
import type { ProductCombo, ComboItem, ComboInput } from '@/types/combo'

// === Pemetaan baris DB <-> ProductCombo ===

type ComboRow = {
  id: string
  name: string
  combo_price: number
  is_active: boolean
  created_at: string
  // Item ter-embed lewat relasi FK combo_id (PostgREST nested select)
  product_combo_items?: ComboItemRow[]
}

type ComboItemRow = {
  id: string
  combo_id: string
  product_id: string
  name: string
  unit_price: number
  quantity: number
  // Opsional: kolom baru (migration 20260918120000). Lingkungan yang belum menjalankannya
  // mengembalikan baris tanpa field ini — dianggap "belum ada produk utama", bukan error.
  is_primary?: boolean | null
  // Opsional: kolom baru (migration 20260918140000). NULL/absen = harga paket produk ini belum
  // dipecah — pembagian proporsional lama yang dipakai.
  deal_price?: number | null
}

function rowToItem(row: ComboItemRow): ComboItem {
  return {
    productId: row.product_id,
    name: row.name,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    isPrimary: row.is_primary === true,
    dealPrice: typeof row.deal_price === 'number' ? row.deal_price : null,
  }
}

function rowToCombo(row: ComboRow): ProductCombo {
  return {
    id: row.id,
    name: row.name,
    comboPrice: row.combo_price,
    isActive: row.is_active,
    items: (row.product_combo_items ?? []).map(rowToItem),
    createdAt: row.created_at,
  }
}

// Petakan item input → baris yang disisipkan ke product_combo_items untuk sebuah combo.
function itemsToRows(comboId: string, items: ComboItem[]) {
  return items.map((item) => ({
    combo_id: comboId,
    product_id: item.productId,
    name: item.name,
    unit_price: item.unitPrice,
    quantity: item.quantity,
    is_primary: item.isPrimary,
    deal_price: item.dealPrice,
  }))
}

// Menyisipkan isi paket, dengan satu jaring pengaman: bila kolom BARU belum ada di database
// (migration 20260918120000 / 20260918140000 belum dijalankan di lingkungan ini), ulangi tanpa
// kolom-kolom itu.
//
// Kenapa repot: tanpa ini, satu lingkungan yang ketinggalan migration membuat seluruh simpan/edit
// paket di OMS gagal — kerusakan yang jauh lebih besar daripada kehilangan penanda produk utama
// (paket kembali tayang di semua anggotanya) atau harga per produk (harga paket dibagi proporsional
// seperti dulu). Keduanya perilaku lama yang masih benar, bukan data rusak.
const KOLOM_BARU = ['is_primary', 'deal_price']

async function insertComboItems(
  supabase: ReturnType<typeof createAdminClient>,
  comboId: string,
  items: ComboItem[],
): Promise<{ message: string } | null> {
  const rows = itemsToRows(comboId, items)
  const { error } = await supabase.from('product_combo_items').insert(rows)
  if (!error) return null

  // 42703 = undefined_column. Nama kolomnya dicocokkan juga agar kolom lain yang hilang tidak ikut
  // ditelan diam-diam oleh percobaan ulang ini.
  const kolomBelumAda =
    error.code === '42703' && KOLOM_BARU.some((kolom) => error.message.includes(kolom))
  if (!kolomBelumAda) return { message: error.message }

  console.warn(
    `Kolom baru product_combo_items belum ada (${error.message}) — jalankan migration ` +
      '20260918120000 & 20260918140000. Paket disimpan dengan perilaku lama.',
  )
  const { error: ulangError } = await supabase.from('product_combo_items').insert(
    rows.map((row) => ({
      combo_id: row.combo_id,
      product_id: row.product_id,
      name: row.name,
      unit_price: row.unit_price,
      quantity: row.quantity,
    })),
  )
  return ulangError ? { message: ulangError.message } : null
}

// === Baca ===

// Membaca seluruh combo beserta itemnya, terbaru di depan.
// Array kosong bila terjadi error agar UI tidak crash.
export async function readCombos(): Promise<ProductCombo[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .select('*, product_combo_items(*)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca combo dari Supabase:', error.message)
    return []
  }

  return (data as ComboRow[]).map(rowToCombo)
}

// Membaca combo AKTIF beserta itemnya untuk STOREFRONT, lewat anon key (tunduk RLS, SEC-031).
//
// Dua lapis yang sengaja bertumpuk: policy database hanya meloloskan is_active = true (isi paket
// mengikuti induknya lewat EXISTS), dan query ini tetap memfilter is_active sendiri. Kalau salah
// satunya kelak berubah, yang lain masih menahan paket nonaktif.
//
// Array kosong bila error — termasuk bila policy/grant belum ada di sebuah lingkungan. Storefront
// lalu tampil tanpa rekomendasi paket (bukan crash); penyebabnya tercatat di log server.
export async function readActiveCombosPublic(): Promise<ProductCombo[]> {
  const supabase = createPublicClient()
  const { data, error } = await supabase
    .from('product_combos')
    .select('*, product_combo_items(*)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca combo aktif (anon) dari Supabase:', error.message)
    return []
  }

  return (data as ComboRow[]).map(rowToCombo)
}

// Jumlah paket TERJUAL per combo, dihitung dari order_items.combo_id.
//
// ── Basis hitung: HANYA pesanan LUNAS ──
// Sengaja berbeda dari aggregateSales (yang menyuplai "N terjual" produk dan menghitung semua
// pesanan kecuali Dibatalkan, termasuk yang tak pernah dibayar). Keputusan pemilik proyek
// 2026-09-07: angka combo dibuat jujur sejak awal, tanpa ikut mengubah angka produk yang sudah
// telanjur tampil di storefront. Karena itu kolomnya di OMS WAJIB berlabel "Terjual (Lunas)" —
// tanpa label, dua angka di layar yang sama jadi tak bisa dibandingkan tanpa ada yang tahu kenapa.
//
// Satu pesanan dihitung SATU paket: pencocokan combo di orders/create menuntut kuantitas persis
// sama dengan isi paket, jadi belum ada cara membeli dua set paket dalam satu pesanan.
//
// Map kosong bila kolom combo_id belum ada (migration 20260907130000 belum dijalankan) — halaman
// OMS menampilkannya sebagai 0, bukan error.
export async function getComboSalesCount(): Promise<Record<string, number>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('order_items')
    .select('combo_id, order_id, orders!inner(status_pembayaran)')
    .not('combo_id', 'is', null)
    .eq('orders.status_pembayaran', 'PAID')

  if (error) {
    // 42703 = kolom combo_id belum ada. Bukan kegagalan yang perlu meledak: laporan penjualan
    // paket memang belum bisa dihitung sampai migration dijalankan.
    console.error('Gagal menghitung penjualan combo:', error.message)
    return {}
  }

  // Pasangan (combo, pesanan) yang unik — satu pesanan tak boleh terhitung berkali-kali hanya
  // karena paketnya berisi beberapa produk.
  const seen = new Set<string>()
  const counts: Record<string, number> = {}
  for (const row of (data ?? []) as { combo_id: string | null; order_id: string }[]) {
    if (!row.combo_id) continue
    const key = `${row.combo_id}::${row.order_id}`
    if (seen.has(key)) continue
    seen.add(key)
    counts[row.combo_id] = (counts[row.combo_id] ?? 0) + 1
  }
  return counts
}

// Membaca satu combo berdasarkan id (beserta itemnya). null bila tidak ditemukan.
export async function getComboById(id: string): Promise<ProductCombo | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .select('*, product_combo_items(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Gagal membaca combo dari Supabase:', error.message)
    return null
  }

  return data ? rowToCombo(data as ComboRow) : null
}

// === Tulis ===

// Membuat combo baru: insert ke product_combos lalu insert semua item ke product_combo_items.
export async function createCombo(input: ComboInput): Promise<ProductCombo> {
  const supabase = createAdminClient()

  const { data: combo, error: comboError } = await supabase
    .from('product_combos')
    .insert({
      name: input.name,
      combo_price: input.comboPrice,
      is_active: input.isActive,
    })
    .select('id')
    .single()

  if (comboError || !combo) {
    throw new Error(`Gagal menyimpan combo: ${comboError?.message ?? 'tidak diketahui'}`)
  }

  const itemsError = await insertComboItems(supabase, combo.id, input.items)

  if (itemsError) {
    // Rollback manual: hapus combo agar tidak tertinggal tanpa item (cascade ikut bersih)
    await supabase.from('product_combos').delete().eq('id', combo.id)
    throw new Error(`Gagal menyimpan item combo: ${itemsError.message}`)
  }

  const created = await getComboById(combo.id)
  if (!created) throw new Error('Combo tersimpan tetapi gagal dibaca ulang.')
  return created
}

// Memperbarui combo: update product_combos, hapus semua item lama, lalu insert ulang item baru.
// null bila combo tidak ditemukan.
export async function updateCombo(id: string, input: ComboInput): Promise<ProductCombo | null> {
  const supabase = createAdminClient()

  const { data: updated, error: updateError } = await supabase
    .from('product_combos')
    .update({
      name: input.name,
      combo_price: input.comboPrice,
      is_active: input.isActive,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Gagal memperbarui combo di Supabase:', updateError.message)
    return null
  }
  if (!updated) return null // combo tidak ditemukan

  // Ganti seluruh item: hapus yang lama lalu insert ulang (pendekatan paling sederhana & konsisten)
  const { error: delError } = await supabase
    .from('product_combo_items')
    .delete()
    .eq('combo_id', id)
  if (delError) {
    console.error('Gagal menghapus item combo lama:', delError.message)
    return null
  }

  const insError = await insertComboItems(supabase, id, input.items)
  if (insError) {
    console.error('Gagal menyisipkan item combo baru:', insError.message)
    return null
  }

  return getComboById(id)
}

// === Ubah status ===

// Mengaktifkan / menonaktifkan combo (kolom is_active). null bila tidak ditemukan.
export async function setComboActive(id: string, isActive: boolean): Promise<ProductCombo | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Gagal mengubah status combo:', error.message)
    return null
  }
  if (!data) return null

  return getComboById(id)
}

// === Hapus ===

// Menghapus combo berdasarkan id. Item ikut terhapus otomatis (ON DELETE CASCADE).
// true bila terhapus, false bila tidak ditemukan.
export async function deleteCombo(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_combos')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('Gagal menghapus combo di Supabase:', error.message)
    return false
  }

  return (data?.length ?? 0) > 0
}
