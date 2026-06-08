'use client'

// src/components/checkout/PaymentModal.tsx
// Bottom-sheet metode pembayaran: daftar Virtual Account (radio) + dropdown "Metode Lainnya" (grid),
// tombol silang (X) untuk menutup, dan tombol Konfirmasi. Pemilihan langsung mengubah state parent.

import { useState } from 'react'
import BottomSheet from '@/components/checkout/BottomSheet'
import type { PaymentMethod } from '@/lib/data/dummy-checkout'

// Menampilkan modal pemilihan metode pembayaran; perubahan diterapkan langsung ke parent.
export default function PaymentModal({
  open,
  onClose,
  methods,
  selectedId,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  methods: PaymentMethod[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  // Dropdown "Metode Lainnya" — tertutup default
  const [showOthers, setShowOthers] = useState(false)

  const virtualAccounts = methods.filter((m) => m.group === 'va')
  const others = methods.filter((m) => m.group === 'other')

  return (
    <BottomSheet open={open} onClose={onClose}>
      {/* Header sheet: judul + tombol silang */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3">
        <h2 className="text-base font-bold text-zinc-800">Metode Pembayaran</h2>
        <button type="button" onClick={onClose} aria-label="Tutup" className="p-1 active:scale-95">
          <CloseIcon />
        </button>
      </div>

      {/* Body scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* === Virtual Account === */}
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Virtual Account</p>
        <ul className="divide-y divide-zinc-100">
          {virtualAccounts.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <MethodBadge name={m.name} />
                <span className="flex-1 text-sm font-medium text-zinc-800">{m.name}</span>
                <RadioCircle active={selectedId === m.id} />
              </button>
            </li>
          ))}
        </ul>

        {/* === Metode Lainnya (dropdown grid) === */}
        <button
          type="button"
          onClick={() => setShowOthers((v) => !v)}
          aria-expanded={showOthers}
          className="mt-4 flex w-full items-center justify-between py-2 text-xs font-bold uppercase tracking-wide text-zinc-400"
        >
          Metode Lainnya
          <ChevronDownIcon className={`transition-transform ${showOthers ? 'rotate-180' : ''}`} />
        </button>

        {showOthers && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {others.map((m) => {
              const active = selectedId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition ${
                    active
                      ? 'border-brand-primary bg-brand-surface'
                      : 'border-zinc-200 bg-white hover:border-brand-primary'
                  }`}
                >
                  <MethodBadge name={m.name} />
                  <span className="text-[11px] font-medium leading-tight text-zinc-700">{m.name}</span>
                </button>
              )
            })}
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

// Placeholder ikon metode pembayaran (inisial pada kotak abu) — TODO: ganti logo resmi.
function MethodBadge({ name }: { name: string }) {
  const initials = name
    .split(/[\s/]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[10px] font-bold text-zinc-600">
      {initials}
    </span>
  )
}

// Lingkaran radio bulat; saat aktif terisi hitam (sesuai contoh "Mandiri tercentang hitam")
function RadioCircle({ active }: { active: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
        active ? 'border-zinc-900' : 'border-zinc-300'
      }`}
    >
      {active && <span className="h-2.5 w-2.5 rounded-full bg-zinc-900" />}
    </span>
  )
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
