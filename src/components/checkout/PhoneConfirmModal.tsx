'use client'

// src/components/checkout/PhoneConfirmModal.tsx
// Popup konfirmasi nomor telepon SEBELUM lanjut ke pembayaran. Muncul setelah validasi form lolos.
// Modal TERPUSAT (centered) dengan overlay gelap menutupi SELURUH halaman termasuk header (z-[60] >
// header z-30). Klik backdrop / "Kembali" / X = onBack (tetap di form, fokuskan field telepon).
// "Lanjutkan Checkout" = onConfirm (proses bayar). Logic/behavior tidak berubah — hanya visual.

import { useEffect } from 'react'
import { ShieldCheck, Info, X } from 'lucide-react'

export default function PhoneConfirmModal({
  open,
  phone,
  onBack,
  onConfirm,
}: {
  open: boolean
  phone: string // ditampilkan APA ADANYA (sudah divalidasi 08xx) — jangan diformat ulang
  onBack: () => void
  onConfirm: () => void
}) {
  // Kunci scroll body selama modal terbuka
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop gelap menutupi seluruh halaman (termasuk header). Klik = batal (sama seperti "Kembali"). */}
      <button
        type="button"
        aria-label="Tutup"
        onClick={onBack}
        className="absolute inset-0 h-full w-full bg-black/50"
      />

      {/* Card popup — centered, rounded besar, di atas backdrop */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white p-6 shadow-2xl"
      >
        {/* Dekorasi lengkung lembut di pojok (opsional) */}
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-light/20" />

        {/* Tombol tutup (X) — perilaku sama seperti "Kembali" */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Tutup"
          className="absolute right-4 top-4 z-10 rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Ikon shield/checklist bulat, aksen hijau lembut */}
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-light/30">
          <ShieldCheck className="h-8 w-8 text-brand-primary" />
        </div>

        {/* Judul — hijau gelap, center */}
        <h2 className="relative mt-4 text-center text-lg font-bold text-green-800">
          Pastikan data yang Anda masukkan benar
        </h2>

        {/* Nomor telepon — badge/pill hijau muda, center */}
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center rounded-full bg-brand-light/40 px-5 py-2 text-center text-base font-bold text-green-800">
            {phone}
          </span>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-500">Nomor yang Anda masukkan</p>

        {/* Catatan/notice — background lembut (soft pink) + ikon info bulat kiri */}
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-rose-50 px-4 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100">
            <Info className="h-3.5 w-3.5 text-rose-500" />
          </span>
          <p className="text-xs leading-relaxed text-rose-900/80">
            Pastikan nomor telepon yang Anda masukkan sudah benar, karena nomor telepon ini akan
            digunakan untuk melacak pesanan, mereview pesanan, dan membatalkan pesanan.
          </p>
        </div>

        {/* Aksi — bentuk tombol DIPERTAHANKAN seperti sebelumnya (jangan diubah) */}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
          >
            Lanjutkan Checkout
          </button>
        </div>
      </div>
    </div>
  )
}
