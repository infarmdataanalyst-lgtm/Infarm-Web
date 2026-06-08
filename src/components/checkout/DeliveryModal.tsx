'use client'

// src/components/checkout/DeliveryModal.tsx
// Bottom-sheet metode pengiriman: opsi rekomendasi + checkbox asuransi, accordion "Lainnya",
// dan tombol Konfirmasi. Pemilihan kurir/asuransi langsung mengubah state parent (total reaktif).

import { useState } from 'react'
import BottomSheet from '@/components/checkout/BottomSheet'
import { formatRupiah } from '@/lib/format'
import { INSURANCE_FEE, type DeliveryOption } from '@/lib/data/dummy-checkout'

// Menampilkan modal pemilihan kurir; perubahan diterapkan langsung ke parent.
export default function DeliveryModal({
  open,
  onClose,
  options,
  selectedId,
  onSelect,
  insuranceEnabled,
  onToggleInsurance,
}: {
  open: boolean
  onClose: () => void
  options: DeliveryOption[]
  selectedId: string
  onSelect: (id: string) => void
  insuranceEnabled: boolean
  onToggleInsurance: (enabled: boolean) => void
}) {
  // Accordion "Lainnya" — tertutup secara default
  const [showOthers, setShowOthers] = useState(false)

  const recommended = options.filter((o) => o.recommended)
  const others = options.filter((o) => !o.recommended)

  return (
    <BottomSheet open={open} onClose={onClose}>
      {/* Header sheet: tombol kembali + judul */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Kembali" className="p-1 active:scale-95">
          <ChevronLeftIcon />
        </button>
        <h2 className="text-base font-bold text-zinc-800">Metode Pengiriman</h2>
      </div>

      {/* Body scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* === Direkomendasikan === */}
        <p className="mb-2 text-sm font-bold text-zinc-800">Direkomendasikan untukmu!</p>
        <div className="space-y-3">
          {recommended.map((opt) => (
            <div key={opt.id} className="rounded-xl border border-brand-light bg-brand-surface p-3">
              <CourierOption
                option={opt}
                selected={selectedId === opt.id}
                onSelect={() => onSelect(opt.id)}
              />

              {/* Checkbox asuransi pengiriman */}
              <label className="mt-3 flex items-start gap-2 border-t border-brand-light/60 pt-3">
                <input
                  type="checkbox"
                  checked={insuranceEnabled}
                  onChange={(e) => onToggleInsurance(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-primary"
                />
                <span className="text-xs text-zinc-600">
                  <span className="font-semibold text-zinc-800">
                    Asuransi pengiriman wajib diaktifkan (+{formatRupiah(INSURANCE_FEE)})
                  </span>
                  <br />
                  Melindungi paketmu dari risiko kerusakan atau kehilangan selama pengiriman.
                </span>
              </label>
            </div>
          ))}
        </div>

        {/* === Lainnya (accordion) === */}
        <button
          type="button"
          onClick={() => setShowOthers((v) => !v)}
          aria-expanded={showOthers}
          className="mt-4 flex w-full items-center justify-between py-2 text-sm font-bold text-zinc-800"
        >
          Lainnya
          <ChevronDownIcon className={`transition-transform ${showOthers ? 'rotate-180' : ''}`} />
        </button>

        {showOthers && (
          <div className="space-y-3">
            {others.map((opt) => (
              <div key={opt.id} className="rounded-xl border border-zinc-200 p-3">
                <CourierOption
                  option={opt}
                  selected={selectedId === opt.id}
                  onSelect={() => !opt.disabled && onSelect(opt.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: tombol Konfirmasi */}
      <div className="shrink-0 border-t border-zinc-100 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-brand-primary py-3 text-base font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
        >
          Konfirmasi
        </button>
      </div>
    </BottomSheet>
  )
}

// === Sub-komponen ===

// Satu opsi kurir: radio + nama + ETA + badge + harga
function CourierOption({
  option,
  selected,
  onSelect,
}: {
  option: DeliveryOption
  selected: boolean
  onSelect: () => void
}) {
  const { courier, etaLabel, price, badge, note, disabled } = option

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="flex w-full items-center gap-3 text-left disabled:opacity-50"
    >
      <RadioDot active={selected} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-800">{courier}</p>
        <p className="text-xs text-zinc-500">{etaLabel}</p>
        {badge && (
          <span className="mt-1 inline-block rounded bg-brand-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
        {note && <p className="mt-1 text-[11px] italic text-zinc-400">{note}</p>}
      </div>
      <span className="shrink-0 text-sm font-bold text-zinc-800">
        {price > 0 ? formatRupiah(price) : '—'}
      </span>
    </button>
  )
}

// Lingkaran radio dengan titik di tengah saat aktif
function RadioDot({ active }: { active: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
        active ? 'border-brand-primary' : 'border-zinc-300'
      }`}
    >
      {active && <span className="h-2.5 w-2.5 rounded-full bg-brand-primary" />}
    </span>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
