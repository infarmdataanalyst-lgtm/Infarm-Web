'use client'

// src/components/checkout/BottomSheet.tsx
// Wrapper modal bottom-sheet reusable: backdrop gelap + panel yang naik dari bawah.
// Transisi murni CSS (digerakkan oleh prop `open`) — selalu termount agar animasi masuk/keluar mulus.

import { useEffect } from 'react'
import type { ReactNode } from 'react'

// Menampilkan konten dalam panel bottom-sheet yang muncul/menghilang sesuai prop `open`.
export default function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  // Kunci scroll body selama sheet terbuka (efek DOM, bukan state)
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}
    >
      {/* Backdrop — fade in/out */}
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={`absolute inset-0 h-full w-full bg-black/40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel sheet — slide up/down */}
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
