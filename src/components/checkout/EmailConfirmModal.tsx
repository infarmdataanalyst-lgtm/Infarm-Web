'use client'

// src/components/checkout/EmailConfirmModal.tsx
// Popup konfirmasi ALAMAT EMAIL sebelum lanjut ke pembayaran. Muncul setelah validasi form lolos.
// Modal TERPUSAT (centered) dengan overlay gelap menutupi SELURUH halaman termasuk header (z-[70] >
// header z-30). Klik backdrop / "Kembali" / X = onBack (tetap di form, fokuskan field email).
// "Lanjutkan Checkout" = onConfirm (proses bayar).
//
// ── Kenapa email, bukan nomor telepon ──
// Popup ini dulu mengonfirmasi no_telepon, dengan alasan "nomor ini dipakai untuk melacak,
// mereview, dan membatalkan pesanan". Alasan itu sudah TIDAK BENAR lagi: ketiga alur tersebut
// berpindah ke pencarian by EMAIL (/track-order, /review, /cancel-order — lihat docs/checkout-flow.md),
// dan invoice pembayaran juga dikirim Xendit ke email. Nomor telepon kini hanya dipakai sebagai
// konfirmasi kedua saat membatalkan, bukan sebagai kunci pencarian.
//
// Membiarkan popup lama berarti pembeli diminta memeriksa dengan teliti justru field yang BUKAN
// penentu — sementara email, satu-satunya jalan ia menerima tagihan dan menemukan pesanannya lagi,
// lewat tanpa diperiksa. Salah ketik email adalah kesalahan yang paling mahal di halaman ini:
// pesanannya tetap terbuat dan stok tetap terpotong, tapi pembelinya tak pernah menerima invoice
// dan tak akan pernah bisa menemukan pesanannya sendiri.

import { useEffect } from 'react'
import { ShieldCheck, Info, X } from 'lucide-react'

export default function EmailConfirmModal({
  open,
  email,
  onBack,
  onConfirm,
}: {
  open: boolean
  email: string // sudah dinormalisasi & divalidasi di AddressForm — jangan diformat ulang di sini
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
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

        {/* Judul — hijau gelap, center. TEKSNYA JANGAN DIUBAH: dipakai sebagai selector di empat
            berkas uji e2e (checkout-edge-cases, checkout-full-payment-flow,
            checkout-order-data-integrity, xendit-va-creation). */}
        <h2 className="relative mt-4 text-center text-lg font-bold text-green-800">
          Pastikan data yang Anda masukkan benar
        </h2>

        {/* Email — badge/pill hijau muda, center.
            break-all: alamat email panjang tak boleh melebar keluar kartu di layar sempit. */}
        <div className="mt-4 flex justify-center">
          <span className="inline-flex max-w-full items-center break-all rounded-full bg-brand-light/40 px-5 py-2 text-center text-base font-bold text-green-800">
            {email}
          </span>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-500">Email yang Anda masukkan</p>

        {/* Catatan/notice — background lembut (soft pink) + ikon info bulat kiri */}
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-rose-50 px-4 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100">
            <Info className="h-3.5 w-3.5 text-rose-500" />
          </span>
          <p className="text-xs leading-relaxed text-rose-900/80">
            Pastikan alamat email yang Anda masukkan sudah benar, karena tagihan pembayaran akan
            dikirim ke email ini — dan email ini pula yang dipakai untuk melacak pesanan, memberi
            ulasan, dan membatalkan pesanan.
          </p>
        </div>

        {/* Aksi — bentuk tombol DIPERTAHANKAN seperti sebelumnya (jangan diubah).
            Label "Lanjutkan Checkout" juga dipakai sebagai selector di berkas uji e2e. */}
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
