// src/lib/mock-db/pickup.ts
// Akses tabel `mengantar_daily_pickup` — SERVER ONLY (createAdminClient / service_role).
// Tabel RLS-aktif tanpa policy publik: jadwal pickup adalah data operasional pengiriman, tak ada
// alasan browser pembeli membacanya. JANGAN impor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'

// Satu baris jadwal pickup harian. Sejak tiap gudang punya alamat penjemputan sendiri, satu tanggal
// bisa punya beberapa baris — satu per alamat (migration 20260922120100) — dan sejak jam jemput bisa
// berbeda per ekspedisi, satu per JAM juga (migration 20261014120000, kolom pickup_hour).
export type DailyPickup = {
  date: string // YYYY-MM-DD (WIB), tanggal PICKUP
  addressId: string // alamat penjemputan pemilik slot ini (warehouses.mengantar_address_id)
  timeId: string // time_id dari Mengantar
  pickupHour: number | null // jam jemput slot ini; null = migration jam belum dijalankan
  createdAt: string
}

type PickupRow = {
  date: string
  address_id: string
  time_id: string
  pickup_hour?: number | null
  created_at: string
}

function rowToPickup(row: PickupRow): DailyPickup {
  return {
    date: row.date,
    addressId: row.address_id,
    timeId: row.time_id,
    pickupHour: typeof row.pickup_hour === 'number' ? row.pickup_hour : null,
    createdAt: row.created_at,
  }
}

// === Kolom pickup_hour belum ada (migration 20261014120000 belum dijalankan) ===
//
// 42703 = kolom tak ada saat SELECT/filter; PGRST204 = PostgREST tak mengenal kolom saat INSERT.
// Keduanya berarti database masih berbentuk lama: satu slot per tanggal & alamat. Semua fungsi di
// bawah lalu mengulang tanpa kolom itu, supaya booking tetap jalan dengan perilaku sebelumnya.
function kolomJamBelumAda(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

const KOLOM_DASAR = 'date, address_id, time_id, created_at'
const KOLOM_LENGKAP = `${KOLOM_DASAR}, pickup_hour`

// Apakah tabel slot sudah menyimpan jam (migration 20261014120000). Dipakai tab Jam Penjemputan
// untuk memberi tahu admin bahwa jam per ekspedisi belum berlaku untuk slot. Gangguan lain → true
// (anggap sudah), supaya galat sesaat tak memunculkan peringatan migration yang menyesatkan.
export async function pickupSlotsSupportHour(): Promise<boolean> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('mengantar_daily_pickup').select('pickup_hour').limit(1)
  return !kolomJamBelumAda(error)
}

// Membaca slot pickup untuk satu tanggal DI SATU ALAMAT pada SATU JAM jemput. null bila belum ada,
// tabel belum di-migrate, atau koneksi bermasalah — pemanggil WAJIB punya jalur cadangan sendiri.
// Jangan biarkan gangguan tabel ini menggagalkan pembuatan order.
//
// `addressId` WAJIB, bukan opsional: tanpa filter alamat, maybeSingle() akan GALAT begitu ada
// gudang kedua (dua baris untuk tanggal yang sama), dan galat itu muncul sebagai "tak ada slot"
// yang menjatuhkan seluruh booking ke jalur fallback. `pickupHour` alasan yang sama untuk dua
// ekspedisi berjam berbeda; tanpa kolom jam (database lama) filter jam dilewati.
export async function getPickupByDate(
  date: string,
  addressId: string,
  pickupHour?: number,
): Promise<DailyPickup | null> {
  const supabase = createAdminClient()
  if (pickupHour !== undefined) {
    const { data, error } = await supabase
      .from('mengantar_daily_pickup')
      .select(KOLOM_LENGKAP)
      .eq('date', date)
      .eq('address_id', addressId)
      .eq('pickup_hour', pickupHour)
      .maybeSingle()
    if (!error) return data ? rowToPickup(data as PickupRow) : null
    if (!kolomJamBelumAda(error)) {
      console.error(`Gagal membaca jadwal pickup ${date} ${pickupHour}:00 alamat ${addressId}:`, error.message)
      return null
    }
    // Database lama: satu slot per tanggal & alamat — baca tanpa jam di bawah.
  }

  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .select(KOLOM_DASAR)
    .eq('date', date)
    .eq('address_id', addressId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(`Gagal membaca jadwal pickup ${date} alamat ${addressId}:`, error.message)
    return null
  }
  return data ? rowToPickup(data as PickupRow) : null
}

// Tanggal-tanggal (≥ `fromDate`) yang sudah punya slot di tabel, untuk alamat mana pun. Dipakai saat
// admin mengubah jam jemput: hanya slot yang SUDAH dibuat yang mungkin berjam lama. [] bila gagal
// membaca — pemanggil memperlakukannya sebagai "tak ada slot untuk dibuang".
export async function listPickupSlotDatesFrom(fromDate: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .select('date')
    .gte('date', fromDate)

  if (error) {
    console.error(`Gagal membaca slot pickup sejak ${fromDate}:`, error.message)
    return []
  }
  return [...new Set((data ?? []).map((r) => (r as { date: string }).date))].sort()
}

// Membuang slot untuk tanggal-tanggal tertentu (semua alamat) supaya booking/cron berikutnya membuat
// slot BARU dengan jam yang sekarang berlaku. Baris lama dibuang, bukan ditimpa: order yang sudah
// dibooking menyimpan time_id-nya sendiri di orders.pickup_time_id, jadi tak ada yang kehilangan
// rujukan. Melempar Error bila gagal — admin harus tahu jam barunya belum akan berlaku.
export async function deletePickupSlotsForDates(dates: readonly string[]): Promise<void> {
  if (dates.length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase.from('mengantar_daily_pickup').delete().in('date', [...dates])
  if (error) throw new Error(`Gagal membuang slot pickup lama: ${error.message}`)
}

// Paket yang SUDAH dibooking (resi terbit, masih Diproses) dengan jadwal jemput ≥ `fromDate`, beserta
// label ekspedisinya (orders.nama_ekspedisi, mis. 'J&T') dan jam slot yang dipakainya. Dipakai
// menghitung paket yang tertinggal di jam lama saat admin mengubah jam jemput — paket itu tak ikut
// pindah karena API Mengantar tak menyediakan penjadwalan ulang. null bila gagal membaca.
//
// `slotHour` dibaca dari mengantar_daily_pickup lewat orders.pickup_time_id; null bila slotnya tak
// ditemukan atau kolom pickup_hour belum ada — pemanggil lalu memakai pembandingan jadwal.
export async function listBookedOrdersFrom(
  fromDate: string,
): Promise<{ pickupDate: string; courierLabel: string | null; slotHour: number | null }[] | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select('pickup_date, nama_ekspedisi, pickup_time_id')
    .gte('pickup_date', fromDate)
    .eq('order_status', 'PROCESSING')
    .eq('shipment_status', 'BOOKED')
    .limit(2000)

  if (error) {
    console.error('Gagal membaca paket terbooking:', error.message)
    return null
  }
  const rows = (data ?? []) as {
    pickup_date: string
    nama_ekspedisi: string | null
    pickup_time_id: string | null
  }[]
  const jamSlot = await slotHoursByTimeId(rows.map((r) => r.pickup_time_id))
  return rows.map((row) => ({
    pickupDate: row.pickup_date,
    courierLabel: row.nama_ekspedisi,
    slotHour: row.pickup_time_id ? (jamSlot.get(row.pickup_time_id) ?? null) : null,
  }))
}

// time_id → pickup_hour untuk slot-slot yang dipakai paket. Map kosong bila gagal membaca atau kolom
// jam belum ada — tak pernah melempar, karena ini hanya mempertajam hitungan peringatan.
async function slotHoursByTimeId(timeIds: readonly (string | null)[]): Promise<Map<string, number>> {
  const ids = [...new Set(timeIds.filter((id): id is string => Boolean(id)))]
  const hasil = new Map<string, number>()
  if (ids.length === 0) return hasil

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .select('time_id, pickup_hour')
    .in('time_id', ids)
  if (error) {
    if (!kolomJamBelumAda(error)) console.error('Gagal membaca jam slot pickup:', error.message)
    return hasil
  }
  for (const r of (data ?? []) as { time_id: string; pickup_hour: number | null }[]) {
    if (typeof r.pickup_hour === 'number') hasil.set(r.time_id, r.pickup_hour)
  }
  return hasil
}

// Hasil penyimpanan: `inserted` false berarti baris untuk tanggal & alamat itu SUDAH ADA dan yang
// dikembalikan adalah milik penulis pertama, bukan nilai yang baru dikirim.
export type SavePickupResult = {
  pickup: DailyPickup
  inserted: boolean
}

// Menyimpan time_id untuk sebuah tanggal di satu alamat, ATOMIK terhadap balapan.
//
// Memakai `insert` biasa lalu menangkap pelanggaran unique (kode 23505), BUKAN pola
// "cek dulu lalu insert": dua pemanggil bersamaan (cron re-run + fallback checkout) sama-sama
// melihat tabel kosong lalu sama-sama menulis. Unique constraint di DB yang memutuskan siapa yang
// menang; yang kalah membaca ulang baris pemenang sehingga KEDUA pemanggil memakai time_id sama.
//
// Juga TIDAK memakai upsert: menimpa time_id yang sudah dipakai order lain hari itu akan membuat
// sebagian paket terdaftar di jadwal pickup yang berbeda dari yang tercatat di sistem.
//
// `pickupHour` ikut ditulis bila kolomnya ada; database lama (tanpa kolom) → diulang tanpa jam.
export async function savePickup(
  date: string,
  addressId: string,
  timeId: string,
  pickupHour?: number,
): Promise<SavePickupResult | null> {
  const supabase = createAdminClient()
  const dasar: Record<string, string | number> = { date, address_id: addressId, time_id: timeId }

  // Satu percobaan insert; `denganJam` menentukan kolom pickup_hour ikut ditulis atau tidak.
  const tulis = async (denganJam: boolean) => {
    const res = await supabase
      .from('mengantar_daily_pickup')
      .insert(denganJam ? { ...dasar, pickup_hour: pickupHour as number } : dasar)
      .select(denganJam ? KOLOM_LENGKAP : KOLOM_DASAR)
      .single()
    return { data: res.data as unknown as PickupRow | null, error: res.error }
  }

  let { data, error } = await tulis(pickupHour !== undefined)
  if (error && pickupHour !== undefined && kolomJamBelumAda(error)) {
    ;({ data, error } = await tulis(false))
  }

  if (!error && data) return { pickup: rowToPickup(data), inserted: true }

  // 23505 = unique_violation pada (date, address_id[, pickup_hour]) → pemanggil lain menang.
  if (error?.code === '23505') {
    const existing = await getPickupByDate(date, addressId, pickupHour)
    if (existing) return { pickup: existing, inserted: false }
  }

  console.error(
    `Gagal menyimpan jadwal pickup ${date} alamat ${addressId}:`,
    error?.message ?? 'tidak diketahui',
  )
  return null
}
