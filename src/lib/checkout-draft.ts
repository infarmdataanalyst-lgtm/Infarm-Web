// src/lib/checkout-draft.ts
// Draf isian checkout (alamat + kurir terpilih) di localStorage, agar refresh di tengah pengisian
// tak menghapus apa yang sudah diketik.
//
// Pola mengikuti src/lib/recently-viewed.ts: satu key sendiri, SATU blob JSON, seluruh akses
// dibungkus try/catch, dan penjaga `typeof window` supaya aman dipanggil dari kode yang ikut
// dirender di server.
//
// ── Kenapa localStorage, bukan cookie seperti keranjang ──
// Cookie ikut terkirim di SETIAP permintaan HTTP. Draf ini memuat nama, nomor telepon, dan alamat
// lengkap — tak ada satu pun yang dibutuhkan server sebelum tombol bayar ditekan, jadi mengirimnya
// bolak-balik di tiap request hanya menambah beban tanpa guna. Keranjang memakai cookie karena
// memang direncanakan terbaca dari Server Component (lihat CLAUDE.md); draf ini tidak.
//
// ── Kenapa SATU blob, bukan satu key per field ──
// Menulis field satu per satu membuka jendela di mana sebagian sudah tersimpan dan sebagian belum.
// Refresh yang jatuh tepat di jendela itu menghasilkan draf setengah jadi — nama baru, alamat lama.
// Satu `setItem` berarti isinya selalu utuh atau tak berubah sama sekali.

import type { AddressFormState } from '@/components/checkout/AddressForm'
import type { WarehouseShippingOption } from '@/lib/mengantar'

const KEY = 'checkout_draft'

// Draf kedaluwarsa setelah 7 hari.
//
// Bukan soal ukuran — draf ini kecil. Ini soal kejutan: alamat yang diketik tiga minggu lalu
// muncul kembali saat orang berbelanja lagi terasa seperti sistem mengingat sesuatu yang tak ia
// minta, dan pada perangkat bersama (tablet keluarga, komputer warnet) itu membocorkan alamat
// orang sebelumnya.
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type CheckoutDraft = {
  address: AddressFormState
  courier: WarehouseShippingOption | null
  savedAt: number
}

// Bentuk alamat kosong — dipakai sebagai nilai awal form dan sebagai fallback saat draf rusak.
export function emptyAddress(): AddressFormState {
  return {
    recipientName: '',
    phone: '',
    destination_id: '',
    provinceName: '',
    cityName: '',
    districtName: '',
    subdistrictName: '',
    postalCode: '',
    street: '',
  }
}

// Memastikan objek yang dibaca benar-benar berbentuk alamat.
//
// Draf bisa berasal dari versi aplikasi yang lebih lama, atau dari localStorage yang disunting
// tangan. Memakainya mentah-mentah berarti `form.recipientName` bisa berisi angka atau undefined,
// dan komponen input terkendali React akan melempar di render pertama — halaman checkout putih
// karena satu nilai busuk di penyimpanan lokal.
function alamatValid(nilai: unknown): nilai is AddressFormState {
  if (typeof nilai !== 'object' || nilai === null) return false
  const kunci: (keyof AddressFormState)[] = [
    'recipientName',
    'phone',
    'destination_id',
    'provinceName',
    'cityName',
    'districtName',
    'subdistrictName',
    'postalCode',
    'street',
  ]
  const obj = nilai as Record<string, unknown>
  return kunci.every((k) => typeof obj[k] === 'string')
}

// Kurir dianggap sah hanya bila membawa seluruh nilai yang dipakai saat membuat pesanan.
// Harga & warehouseId yang hilang berarti tombol bayar aktif tapi payload-nya cacat.
function kurirValid(nilai: unknown): nilai is WarehouseShippingOption {
  if (typeof nilai !== 'object' || nilai === null) return false
  const obj = nilai as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.price === 'number' &&
    Number.isFinite(obj.price) &&
    typeof obj.warehouseId === 'string'
  )
}

// Membaca draf tersimpan. `null` bila tak ada, rusak, atau sudah kedaluwarsa.
//
// TIDAK PERNAH melempar: localStorage bisa tak tersedia (mode privat), penuh, atau berisi teks yang
// bukan JSON. Semua itu berakhir sama — form kosong, checkout tetap bisa dipakai.
export function readCheckoutDraft(): CheckoutDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CheckoutDraft>
    if (!alamatValid(parsed?.address)) return null

    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    if (!savedAt || Date.now() - savedAt > TTL_MS) {
      clearCheckoutDraft()
      return null
    }

    return {
      address: parsed.address,
      // Alamat sah tapi kurir busuk → alamatnya tetap dipulihkan, kurirnya dibuang.
      // Membuang keduanya menghukum pengguna atas kerusakan di bagian yang bisa dipilih ulang
      // dalam satu ketukan.
      courier: kurirValid(parsed.courier) ? parsed.courier : null,
      savedAt,
    }
  } catch {
    return null
  }
}

// Menyimpan seluruh isian sebagai SATU objek utuh.
//
// Dipanggil dari efek ber-debounce di halaman checkout — bukan pada tiap ketukan.
export function writeCheckoutDraft(
  address: AddressFormState,
  courier: WarehouseShippingOption | null,
): void {
  if (typeof window === 'undefined') return
  try {
    const draft: CheckoutDraft = { address, courier, savedAt: Date.now() }
    window.localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Penuh / mode privat / disabled → abaikan. Menyimpan draf adalah kemudahan, bukan syarat
    // checkout; menggagalkan alur bayar karena penyimpanan lokal penuh jelas tak sepadan.
  }
}

// Menghapus draf. Dipanggil setelah pesanan berhasil dibuat.
//
// Tanpa ini draf lama menyangkut, dan belanja berikutnya dimulai dengan alamat pesanan sebelumnya
// yang sudah terisi — terlihat seperti sistem salah mengambil data, bukan seperti bantuan.
export function clearCheckoutDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // idem
  }
}

// Apakah draf punya isi yang layak dipulihkan.
//
// Draf yang seluruh fieldnya kosong sama saja dengan tak ada draf — dipakai agar penulisan tak
// terpicu hanya karena halaman checkout dibuka lalu ditinggalkan tanpa diisi apa pun.
export function draftAdaIsinya(
  address: AddressFormState,
  courier: WarehouseShippingOption | null,
): boolean {
  if (courier) return true
  return Object.values(address).some((v) => v.trim() !== '')
}
