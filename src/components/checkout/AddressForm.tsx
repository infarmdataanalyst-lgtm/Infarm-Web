'use client'

// src/components/checkout/AddressForm.tsx
// Form input alamat pengiriman. Wilayah diisi lewat SATU search combobox ke API Mengantar:
// user mencari alamat → memilih hasil → Provinsi/Kota/Kecamatan/Kelurahan/Kode Pos terisi
// otomatis (read-only) dan _id hasil disimpan sebagai destination_id (untuk cek ongkir).
// Validasi field (nama, telepon, alamat terpilih, alamat lengkap) dilakukan client-side:
// per field saat onBlur, dan seluruhnya saat parent memanggil revealErrors() lewat ref.
// TODO: validasi & simpan ke server saat alur order dibuat (lihat CLAUDE.md — validasi di server).

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { MapPin, CheckCircle2 } from 'lucide-react'
import AddressSearchCombobox from '@/components/checkout/AddressSearchCombobox'
import { toTitleCase, type MengantarAddress } from '@/lib/mengantar'
import { normalizePhone, isValidPhone, getPhoneError, sanitizePhoneInput } from '@/lib/phone'
import {
  validateAddress,
  type AddressFieldKey,
  type AddressValidationResult,
} from '@/lib/checkout-validation'

// Bentuk data form alamat. destination_id = _id alamat Mengantar (dipakai cek ongkir berikutnya).
export type AddressFormState = {
  recipientName: string
  phone: string
  destination_id: string
  provinceName: string
  cityName: string
  districtName: string
  subdistrictName: string
  postalCode: string
  street: string
}

// API imperatif yang dibuka ke parent: tampilkan semua error & scroll ke field pertama yang invalid.
export type AddressFormHandle = {
  revealErrors: () => boolean // mengembalikan true bila valid
  focusPhone: () => void // scroll + fokus ke field nomor telepon (mis. dari popup konfirmasi "Kembali")
}

// Tombol kontrol yang tidak boleh diblok di input telepon
const PHONE_ALLOWED_CONTROL_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Tab',
  'Enter',
  'Escape',
])

// Nilai awal form: seluruh field kosong (tidak ada prefill default).
function initialForm(): AddressFormState {
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

// Menampilkan form pengisian alamat pengiriman.
// onChange: mengabarkan nilai form terbaru ke parent setiap ada perubahan
// (agar data alamat, telepon & destination_id siap dipakai saat membuat order / cek ongkir).
// initialValue: isian awal untuk memulihkan draf yang tersimpan (lihat lib/checkout-draft.ts).
// Dibaca SEKALI saat mount — komponen ini memegang state formnya sendiri, jadi perubahan prop
// setelahnya sengaja diabaikan supaya ketikan pengguna tak pernah tertimpa dari luar.
const AddressForm = forwardRef<AddressFormHandle, {
  onChange?: (address: AddressFormState) => void
  initialValue?: AddressFormState
}>(function AddressForm({ onChange, initialValue }, ref) {
  const [form, setForm] = useState<AddressFormState>(() => initialValue ?? initialForm())

  // Teks yang ditampilkan untuk telepon (form.phone menyimpan hasil normalisasi).
  //
  // Ikut di-seed dari draf. Kalau tidak, nomor yang dipulihkan tersimpan di `form.phone` (dipakai
  // validasi & pengiriman order) tapi kotaknya tampak KOSONG — pengguna mengetik ulang di atas
  // nilai yang sebenarnya sudah ada.
  const [phoneInput, setPhoneInput] = useState(() => initialValue?.phone ?? '')

  // Pesan error per field (kosong = tidak ada error). Mengatur juga border merah.
  const [errors, setErrors] = useState<AddressValidationResult['errors']>({})

  // Ref tiap field untuk auto-scroll ke field pertama yang belum valid
  const recipientNameRef = useRef<HTMLDivElement>(null)
  const phoneRef = useRef<HTMLDivElement>(null)
  const phoneInputRef = useRef<HTMLInputElement>(null)
  const addressRef = useRef<HTMLDivElement>(null)
  const streetRef = useRef<HTMLDivElement>(null)
  const fieldRefs: Record<AddressFieldKey, RefObject<HTMLDivElement | null>> = {
    recipientName: recipientNameRef,
    phone: phoneRef,
    destination_id: addressRef,
    street: streetRef,
  }

  // Set/hapus error satu field
  function setFieldError(key: AddressFieldKey, message: string) {
    setErrors((prev) => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  // Perbarui sebagian field lalu kabarkan nilai terbaru ke parent
  function updateForm(patch: Partial<AddressFormState>) {
    const next = { ...form, ...patch }
    setForm(next)
    onChange?.(next)
  }

  // === Nama penerima ===
  function handleNameChange(value: string) {
    updateForm({ recipientName: value })
    if (errors.recipientName && value.trim().length >= 3) setFieldError('recipientName', '')
  }
  function handleNameBlur() {
    setFieldError('recipientName', form.recipientName.trim().length < 3 ? 'Nama penerima minimal 3 karakter' : '')
  }

  // === Telepon: blokir non-digit & kelebihan panjang langsung saat mengetik ===
  function handlePhoneKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return // izinkan shortcut (copy/paste/select-all)
    const key = e.key
    if (PHONE_ALLOWED_CONTROL_KEYS.has(key)) return
    if (key.length !== 1) return // abaikan key non-karakter lain

    const input = e.currentTarget
    const isDigit = key >= '0' && key <= '9'

    if (!isDigit) {
      e.preventDefault()
      setFieldError('phone', 'Nomor telepon hanya boleh berisi angka, tanpa spasi atau tanda hubung')
      return
    }

    // Blokir digit ke-13 (kecuali sedang mengganti teks yang diseleksi)
    const hasSelection = input.selectionStart !== input.selectionEnd
    if (!hasSelection && normalizePhone(input.value).length >= 12) {
      e.preventDefault()
      setFieldError('phone', 'Nomor telepon terlalu panjang, maksimal 12 digit')
    }
  }

  // onChange: jaring pengaman (mis. paste) — bersihkan & potong, lalu simpan angka bersih
  function handlePhoneChange(raw: string) {
    const { value, blockedNonDigit, blockedTooLong } = sanitizePhoneInput(raw)
    setPhoneInput(value)
    updateForm({ phone: value })

    if (blockedTooLong) {
      setFieldError('phone', 'Nomor telepon terlalu panjang, maksimal 12 digit')
    } else if (blockedNonDigit) {
      setFieldError('phone', 'Nomor telepon hanya boleh berisi angka, tanpa spasi atau tanda hubung')
    } else {
      setFieldError('phone', '') // input bersih → hapus pesan blok
    }
  }

  function handlePhoneBlur() {
    setFieldError('phone', getPhoneError(phoneInput))
  }

  const phoneValid = isValidPhone(form.phone)

  // === Alamat (combobox Mengantar) ===
  const hasSelectedAddress = form.destination_id !== ''

  function handleSelectAddress(address: MengantarAddress) {
    updateForm({
      destination_id: address._id,
      provinceName: address.PROVINCE_NAME,
      cityName: address.CITY_NAME,
      districtName: address.DISTRICT_NAME,
      subdistrictName: address.SUBDISTRICT_NAME,
      postalCode: address.ZIP_CODE,
    })
    setFieldError('destination_id', '') // alamat terpilih → hapus error
  }

  function handleResetAddress() {
    updateForm({
      destination_id: '',
      provinceName: '',
      cityName: '',
      districtName: '',
      subdistrictName: '',
      postalCode: '',
    })
  }

  // === Alamat lengkap (jalan & nomor) ===
  function handleStreetChange(value: string) {
    updateForm({ street: value })
    if (errors.street && value.trim().length >= 10) setFieldError('street', '')
  }
  function handleStreetBlur() {
    setFieldError('street', form.street.trim().length < 10 ? 'Alamat lengkap minimal 10 karakter' : '')
  }

  // === API imperatif: validasi semua, tampilkan error, scroll ke field pertama yang invalid ===
  useImperativeHandle(
    ref,
    () => ({
      revealErrors() {
        const result = validateAddress(form)
        setErrors(result.errors)
        if (result.firstInvalid) {
          fieldRefs[result.firstInvalid].current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return result.valid
      },
      focusPhone() {
        phoneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Fokus input setelah scroll agar cursor langsung di field nomor telepon
        phoneInputRef.current?.focus()
      },
    }),
    // fieldRefs stabil (ref); cukup bergantung pada form
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form],
  )

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">Alamat Pengiriman</h2>

      <div className="space-y-3">
        <div ref={recipientNameRef}>
          <Field label="Nama Lengkap Penerima">
            <input
              type="text"
              value={form.recipientName}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="Masukkan nama lengkap penerima"
              aria-invalid={Boolean(errors.recipientName)}
              className={inputClass(Boolean(errors.recipientName))}
            />
          </Field>
          <FieldError message={errors.recipientName} />
        </div>

        <div ref={phoneRef}>
          <Field label="Nomor Telepon Aktif">
            <div className="relative">
              <input
                ref={phoneInputRef}
                type="tel"
                inputMode="numeric"
                value={phoneInput}
                onKeyDown={handlePhoneKeyDown}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onBlur={handlePhoneBlur}
                placeholder="Contoh: 081234567890"
                aria-invalid={Boolean(errors.phone)}
                className={`${inputClass(Boolean(errors.phone))} ${phoneValid ? 'pr-10' : ''}`}
              />
              {/* Indikator hijau saat nomor valid */}
              {phoneValid && (
                <CheckCircle2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-primary" />
              )}
            </div>
          </Field>
          <FieldError message={errors.phone} />
        </div>

        {/* === Wilayah: mode pencarian ATAU ringkasan alamat terpilih === */}
        <div ref={addressRef}>
          {!hasSelectedAddress ? (
            <>
              <Field label="Cari Alamat (Kelurahan / Kecamatan / Kota)">
                <AddressSearchCombobox onSelect={handleSelectAddress} />
              </Field>
              <FieldError message={errors.destination_id} />
            </>
          ) : (
            <div className="rounded-lg border border-brand-light bg-brand-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none text-brand-primary" />
                  <div className="text-sm">
                    <p className="font-semibold text-zinc-800">
                      {toTitleCase(form.subdistrictName)}, {toTitleCase(form.districtName)}
                    </p>
                    <p className="text-zinc-500">
                      {toTitleCase(form.cityName)}, {toTitleCase(form.provinceName)} {form.postalCode}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResetAddress}
                  className="flex-none text-xs font-semibold text-brand-primary underline transition hover:no-underline"
                >
                  Ubah Alamat
                </button>
              </div>

              {/* Rincian wilayah read-only hasil auto-fill */}
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-brand-light/60 pt-3 sm:grid-cols-2">
                <ReadOnlyField label="Provinsi" value={toTitleCase(form.provinceName)} />
                <ReadOnlyField label="Kota/Kabupaten" value={toTitleCase(form.cityName)} />
                <ReadOnlyField label="Kecamatan" value={toTitleCase(form.districtName)} />
                <ReadOnlyField label="Kelurahan" value={toTitleCase(form.subdistrictName)} />
                <ReadOnlyField label="Kode Pos" value={form.postalCode} />
              </div>
            </div>
          )}
        </div>

        <div ref={streetRef}>
          <Field label="Alamat Lengkap (Nama Jalan & Nomor Rumah)">
            <textarea
              value={form.street}
              onChange={(e) => handleStreetChange(e.target.value)}
              onBlur={handleStreetBlur}
              placeholder="Jl. Contoh No. 12, RT/RW, patokan..."
              rows={3}
              aria-invalid={Boolean(errors.street)}
              // lg:min-h-28 — di desktop kolom kiri jauh lebih lega, dan textarea setinggi 3 baris
              // terasa sempit dibanding field lain di sekitarnya. Mobile tetap 3 baris.
              className={`${inputClass(Boolean(errors.street))} resize-none lg:min-h-28`}
            />
          </Field>
          <FieldError message={errors.street} />
        </div>
      </div>
    </section>
  )
})

export default AddressForm

// Kelas input konsisten: border tipis, fokus hijau brand. Border merah saat error.
function inputClass(hasError: boolean): string {
  const base =
    'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 transition focus:outline-none focus:ring-2'
  return hasError
    ? `${base} border-red-400 focus:border-red-400 focus:ring-red-200`
    : `${base} border-zinc-200 focus:border-brand-primary focus:ring-brand-primary/30`
}

// Wrapper label + field
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  )
}

// Pesan error di bawah field (tidak render apa pun bila kosong)
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1 text-xs text-red-500" role="alert">
      {message}
    </p>
  )
}

// Field read-only untuk menampilkan hasil auto-fill wilayah (tidak bisa diedit manual)
// `label`, bukan `div` seperti sebelumnya — sama dengan komponen `Field` di atas.
// Tanpa pembungkus label, input read-only ini tak punya nama yang bisa diakses: pembaca layar
// hanya membacakan nilainya ("Jakarta Pusat") tanpa menyebut itu kolom apa, dan pengujian tak bisa
// menjangkaunya lewat label. Murni perubahan penanda; tampilan & perilakunya sama persis.
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      <input
        type="text"
        value={value}
        readOnly
        className="w-full cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600"
      />
    </label>
  )
}
