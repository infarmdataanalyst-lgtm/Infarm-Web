// src/components/checkout/OptionRow.tsx
// Baris pilihan yang bisa diklik (pengiriman / pembayaran): ikon, label, nilai aktif, dan panah.
// Mengklik baris memicu modal terkait (lewat onClick dari parent).

import type { ReactNode } from 'react'

// Menampilkan satu baris pilihan dengan judul, nilai terpilih saat ini, dan penanda dapat diklik.
export default function OptionRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 bg-white px-4 py-4 text-left transition active:bg-zinc-50"
    >
      <span className="shrink-0 text-brand-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-zinc-500">{title}</p>
        <p className="truncate text-sm font-semibold text-zinc-800">{value}</p>
      </div>
      <ChevronRightIcon className="shrink-0 text-zinc-400" />
    </button>
  )
}

function ChevronRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
