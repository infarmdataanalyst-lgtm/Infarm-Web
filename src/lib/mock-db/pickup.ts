// src/lib/mock-db/pickup.ts
// Akses tabel `mengantar_daily_pickup` — SERVER ONLY (createAdminClient / service_role).
// Tabel RLS-aktif tanpa policy publik: jadwal pickup adalah data operasional pengiriman, tak ada
// alasan browser pembeli membacanya. JANGAN impor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'

// Satu baris jadwal pickup harian.
export type DailyPickup = {
  date: string // YYYY-MM-DD (WIB), tanggal PICKUP
  timeId: string // time_id dari Mengantar
  createdAt: string
}

type PickupRow = {
  date: string
  time_id: string
  created_at: string
}

function rowToPickup(row: PickupRow): DailyPickup {
  return { date: row.date, timeId: row.time_id, createdAt: row.created_at }
}

// Membaca jadwal pickup untuk satu tanggal. null bila belum ada, tabel belum di-migrate, atau
// koneksi bermasalah — pemanggil WAJIB punya jalur cadangan sendiri. Jangan biarkan gangguan
// tabel ini menggagalkan pembuatan order.
export async function getPickupByDate(date: string): Promise<DailyPickup | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .select('date, time_id, created_at')
    .eq('date', date)
    .maybeSingle()

  if (error) {
    console.error(`Gagal membaca jadwal pickup ${date}:`, error.message)
    return null
  }
  return data ? rowToPickup(data as PickupRow) : null
}

// Hasil penyimpanan: `inserted` false berarti baris untuk tanggal itu SUDAH ADA dan yang
// dikembalikan adalah milik penulis pertama, bukan nilai yang baru dikirim.
export type SavePickupResult = {
  pickup: DailyPickup
  inserted: boolean
}

// Menyimpan time_id untuk sebuah tanggal, ATOMIK terhadap balapan.
//
// Memakai `insert` biasa lalu menangkap pelanggaran unique (kode 23505), BUKAN pola
// "cek dulu lalu insert": dua pemanggil bersamaan (cron re-run + fallback checkout) sama-sama
// melihat tabel kosong lalu sama-sama menulis. Unique constraint di DB yang memutuskan siapa yang
// menang; yang kalah membaca ulang baris pemenang sehingga KEDUA pemanggil memakai time_id sama.
//
// Juga TIDAK memakai upsert: menimpa time_id yang sudah dipakai order lain hari itu akan membuat
// sebagian paket terdaftar di jadwal pickup yang berbeda dari yang tercatat di sistem.
export async function savePickup(date: string, timeId: string): Promise<SavePickupResult | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mengantar_daily_pickup')
    .insert({ date, time_id: timeId })
    .select('date, time_id, created_at')
    .single()

  if (!error && data) return { pickup: rowToPickup(data as PickupRow), inserted: true }

  // 23505 = unique_violation → pemanggil lain menang. Ambil punya dia.
  if (error?.code === '23505') {
    const existing = await getPickupByDate(date)
    if (existing) return { pickup: existing, inserted: false }
  }

  console.error(`Gagal menyimpan jadwal pickup ${date}:`, error?.message ?? 'tidak diketahui')
  return null
}
