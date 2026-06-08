'use client'

// src/components/checkout/AddressForm.tsx
// Form input alamat pengiriman. State dikelola lokal (belum disubmit ke server).
// TODO: validasi & simpan ke server saat alur order dibuat (lihat CLAUDE.md — validasi di server).

import { useState } from 'react'
import type { ShippingAddress } from '@/lib/data/dummy-checkout'

// Bentuk data form alamat
type AddressFormState = {
  recipientName: string
  phone: string
  street: string
  village: string // Kelurahan
  district: string // Kecamatan
  cityPostal: string // Kota/Kabupaten & Kode Pos
}

// Menampilkan form pengisian alamat pengiriman dengan input bergaya bersih.
export default function AddressForm({ defaultAddress }: { defaultAddress: ShippingAddress }) {
  // Prefill sebagian field dari alamat dummy agar mudah diuji
  const [form, setForm] = useState<AddressFormState>({
    recipientName: defaultAddress.recipientName,
    phone: defaultAddress.phone,
    street: '',
    village: '',
    district: '',
    cityPostal: '',
  })

  // Memperbarui satu field form berdasarkan nama field
  function updateField(field: keyof AddressFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">Alamat Pengiriman</h2>

      <div className="space-y-3">
        <Field label="Nama Lengkap Penerima">
          <input
            type="text"
            value={form.recipientName}
            onChange={(e) => updateField('recipientName', e.target.value)}
            placeholder="Nama penerima"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Nomor Telepon Aktif">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => updateField('phone', e.target.value)}
            placeholder="08xxxxxxxxxx"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Alamat Lengkap (Nama Jalan & Nomor Rumah)">
          <textarea
            value={form.street}
            onChange={(e) => updateField('street', e.target.value)}
            placeholder="Jl. Contoh No. 12, RT/RW, patokan..."
            rows={3}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>

        {/* Kelurahan & Kecamatan berdampingan di layar lebih lebar */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kelurahan">
            <input
              type="text"
              value={form.village}
              onChange={(e) => updateField('village', e.target.value)}
              placeholder="Kelurahan"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Kecamatan">
            <input
              type="text"
              value={form.district}
              onChange={(e) => updateField('district', e.target.value)}
              placeholder="Kecamatan"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field label="Kota/Kabupaten & Kode Pos">
          <input
            type="text"
            value={form.cityPostal}
            onChange={(e) => updateField('cityPostal', e.target.value)}
            placeholder="Kota/Kabupaten, 12345"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
    </section>
  )
}

// Kelas input konsisten: border tipis, fokus hijau brand
const INPUT_CLASS =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 transition focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30'

// Wrapper label + field
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  )
}
