'use client'

// src/components/oms/CourierSelect.tsx
// Dropdown "Berlaku untuk" di Pengaturan → Jam Penjemputan: Semua ekspedisi, atau satu ekspedisi
// (J&T, Shopee Express, …) lengkap dengan logo kecilnya.
//
// Kenapa Headless UI Listbox, bukan <select>: <option> native tak bisa memuat gambar, dan logo
// itulah yang membuat admin langsung tahu ekspedisi mana yang sedang ia atur — permintaan pemilik
// 2026-10-14 ("dropdown untuk SPX atau J&T disertai logonya kecil"). Polanya sama dengan dropdown
// urutan di katalog (ProductCatalog.tsx).
//
// Nilai '' = semua ekspedisi. Daftar ekspedisi datang dari server (OFFERED_COURIER_IDS), jadi kurir
// baru yang ditawarkan ke pembeli otomatis muncul di sini.

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check, ChevronDown, Layers } from 'lucide-react'
import CourierLogo from '@/components/checkout/CourierLogo'

export type CourierOption = { id: string; label: string }

export const SEMUA_EKSPEDISI = ''

// Isi satu baris (tombol maupun opsi): logo + nama, atau ikon tumpuk untuk "Semua ekspedisi".
function Isi({ id, label }: { id: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {id === SEMUA_EKSPEDISI ? (
        <span className="flex h-4 w-10 flex-none items-center" aria-hidden>
          <Layers className="h-4 w-4 text-gray-500" />
        </span>
      ) : (
        <CourierLogo courier={id} label={label} size="xs" />
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}

export default function CourierSelect({
  value,
  onChange,
  options,
  disabled,
  id,
}: {
  value: string
  onChange: (value: string) => void
  options: CourierOption[]
  disabled?: boolean
  id?: string
}) {
  const semua: CourierOption = { id: SEMUA_EKSPEDISI, label: 'Semua ekspedisi' }
  const daftar = [semua, ...options]
  const terpilih = daftar.find((o) => o.id === value) ?? semua

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <ListboxButton
        id={id}
        className="relative mt-1 w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-3 pr-9 text-left text-sm text-gray-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 data-[disabled]:bg-gray-50 data-[disabled]:text-gray-500"
      >
        <Isi id={terpilih.id} label={terpilih.label} />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      </ListboxButton>
      <ListboxOptions
        anchor="bottom start"
        transition
        className="z-50 w-[var(--button-width)] origin-top rounded-xl border border-gray-100 bg-white p-1 shadow-lg transition duration-150 ease-out [--anchor-gap:4px] focus:outline-none data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        {daftar.map((o) => (
          <ListboxOption
            key={o.id || 'semua'}
            value={o.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 transition-colors data-[focus]:bg-brand-surface data-[selected]:font-semibold data-[selected]:text-brand-primary"
          >
            {({ selected }) => (
              <>
                <Isi id={o.id} label={o.label} />
                {selected && <Check className="h-4 w-4 shrink-0" />}
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
