// src/lib/checkout-validation.ts
// Validasi section Alamat Pengiriman di checkout (client-side, sebelum request apapun dikirim).
// Dipakai bersama oleh AddressForm (tampilkan error per field) & halaman checkout (status tombol).

import { getPhoneError } from './phone'
import { getEmailError } from './email'

// Field wajib pada section alamat. Urutan = urutan tampilan (untuk scroll ke field pertama yang error).
export type AddressFieldKey = 'recipientName' | 'phone' | 'email' | 'destination_id' | 'street'

// Subset field yang divalidasi (AddressFormState memenuhinya secara struktural).
export type AddressValidationInput = {
  recipientName: string
  phone: string
  email: string
  destination_id: string
  street: string
}

export type AddressValidationResult = {
  valid: boolean
  errors: Partial<Record<AddressFieldKey, string>>
  firstInvalid: AddressFieldKey | null
}

// Urutan field sesuai tampilan form
const FIELD_ORDER: AddressFieldKey[] = ['recipientName', 'phone', 'email', 'destination_id', 'street']

// Memvalidasi seluruh field alamat. Mengembalikan status valid, pesan error per field,
// dan field pertama yang belum valid (untuk auto-scroll saat submit).
export function validateAddress(a: AddressValidationInput): AddressValidationResult {
  const errors: Partial<Record<AddressFieldKey, string>> = {}

  if (a.recipientName.trim().length < 3) {
    errors.recipientName = 'Nama penerima minimal 3 karakter'
  }

  const phoneError = getPhoneError(a.phone)
  if (phoneError) errors.phone = phoneError

  const emailError = getEmailError(a.email)
  if (emailError) errors.email = emailError

  if (!a.destination_id) {
    errors.destination_id = 'Pilih alamat pengiriman dari hasil pencarian'
  }

  if (a.street.trim().length < 10) {
    errors.street = 'Alamat lengkap minimal 10 karakter'
  }

  const firstInvalid = FIELD_ORDER.find((key) => errors[key]) ?? null
  return { valid: Object.keys(errors).length === 0, errors, firstInvalid }
}
