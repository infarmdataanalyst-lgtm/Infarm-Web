// src/lib/mock-db/pickup.ts
// Akses tabel `mengantar_daily_pickup` — SERVER ONLY (createAdminClient / service_role).
// Tabel RLS-aktif tanpa policy publik: jadwal pickup adalah data operasional pengiriman, tak ada
// alasan browser pembeli membacanya. JANGAN impor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'

// Satu baris jadwal pickup harian. Sejak tiap gudang punya alamat penjemputan sendiri, satu tanggal
// bisa punya beberapa baris — satu per alamat (migration 20260922120100).
export type DailyPickup = {
  date: string // YYYY-MM-DD (WIB), tanggal PICKUP
  addressId: string // alamat penjemputan pemilik slot ini (warehouses.mengantar_address_id)
  timeId: string // time_id dari Mengantar
  createdAt: string
}

type PickupRow = {
  date: string
  address_id: string
  time_id: string
  created_at: string
}

function rowToPickup(row: PickupRow): DailyPickup {
  return {
    date: row.date,
    addressId: row.address_id,
    timeId: row.time_id,
    createdAt: row.created_at,
  }
}

// Membaca jadwal pickup untuk satu tanggal DI SATU ALAMAT. null bila belum ada, tabel belum
// di-migrate, atau koneksi bermasalah — pemanggil WAJIB punya jalur cadangan sendiri. Jangan
// biarkan gangguan tabel ini menggagalkan pembuatan order.
//
// `addressId` WAJIB, bukan opsional: tanpa filter alamat, maybeSingle() akan GALAT begitu ada
// gudang kedua (dua baris untuk tanggal yang sama), dan galat itu muncul sebagai "tak ada slot"
// yang menjatuhkan seluruh booking ke jalur fallback.
export async function getPickupByDate(
  date: string,
  addressId: string,
): Promise<DailyPickup | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .select('date, address_id, time_id, created_at')
    .eq('date', date)
    .eq('address_id', addressId)
    .maybeSingle()

  if (error) {
    console.error(`Gagal membaca jadwal pickup ${date} alamat ${addressId}:`, error.message)
    return null
  }
  return data ? rowToPickup(data as PickupRow) : null
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
export async function savePickup(
  date: string,
  addressId: string,
  timeId: string,
): Promise<SavePickupResult | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .insert({ date, address_id: addressId, time_id: timeId })
    .select('date, address_id, time_id, created_at')
    .single()

  if (!error && data) return { pickup: rowToPickup(data as PickupRow), inserted: true }

  // 23505 = unique_violation pada (date, address_id) → pemanggil lain menang. Ambil punya dia.
  if (error?.code === '23505') {
    const existing = await getPickupByDate(date, addressId)
    if (existing) return { pickup: existing, inserted: false }
  }

  console.error(
    `Gagal menyimpan jadwal pickup ${date} alamat ${addressId}:`,
    error?.message ?? 'tidak diketahui',
  )
  return null
}
