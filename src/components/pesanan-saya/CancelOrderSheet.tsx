'use client'

// src/components/pesanan-saya/CancelOrderSheet.tsx
// Bottom sheet konfirmasi pembatalan pesanan oleh pembeli, dua langkah di satu panel:
//   1. verifikasi no_telepon  → POST /api/orders/verify-cancel  (query ulang DB, tak membatalkan)
//   2. klik "Ya, Batalkan"    → POST /api/orders/cancel-by-phone (email + telepon diverifikasi ulang)
//
// ── DUA IDENTITAS, disengaja (SEC-037) ──
// Pembatalan menuntut dua data berbeda dari pesanan yang sama: EMAIL dan NO_TELEPON. Email boleh
// datang dari cookie (ia identitas pencarian, sama seperti di daftar pesanan); no_telepon diketik
// manual dan TIDAK pernah di-prefill. Keduanya diperiksa SERVER; sheet ini hanya mengantar.
//
// Dipakai dari halaman detail /track (TrackOrderActions). Halaman itu dibuka lewat nomor invoice
// tanpa identitas apa pun, karena itu email ikut ditanyakan di sini bila cookie tak ada.
// Dulu alur ini halaman tersendiri (/cancel-order); dipindah saat Pesanan Saya dilebur (2026-10-09).

import { useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, Ban, CheckCircle2, X } from 'lucide-react'
import BottomSheet from '@/components/checkout/BottomSheet'
import HoneypotField from '@/components/pesanan-saya/HoneypotField'
import { fmtInvoice, formatShortDate } from '@/components/pesanan-saya/OrderCard'
import { isValidPhone } from '@/lib/phone'
import { isValidEmail, normalizeEmail } from '@/lib/email'
import { getGuestEmail } from '@/lib/guest-email'

const PLACEHOLDER = '/images/product-placeholder.png'

// Data minimum yang perlu ditampilkan & dikirim. Sengaja bukan PublicTrackOrder utuh supaya
// halaman detail (Server Component) bisa menyusunnya dari Order tanpa memuat keadaan ulasan.
export type CancelSheetOrder = {
  orderId: string
  status: string
  date: string
  items: { productId: string; name: string; quantity: number; imageUrl: string | null }[]
}

export default function CancelOrderSheet({
  order,
  onClose,
  onCancelled,
}: {
  order: CancelSheetOrder | null // null = tertutup
  onClose: () => void
  onCancelled: (orderId: string) => void
}) {
  return (
    <BottomSheet open={order !== null} onClose={onClose}>
      {/* Kepala sheet */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-bold text-gray-900">Batalkan Pesanan</h2>
        <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-full p-1 text-gray-500 transition hover:bg-gray-100">
          <X className="h-5 w-5" />
        </button>
      </div>
      {/* `key` = nomor pesanan: pesanan lain → komponen baru → form mulai dari nol. Nomor telepon
          pesanan sebelumnya tak boleh tersisa, dan status "cocok" milik pesanan lama tak boleh terbawa. */}
      {order && <CancelOrderBody key={order.orderId} order={order} onCancelled={onCancelled} />}
    </BottomSheet>
  )
}

function CancelOrderBody({
  order,
  onCancelled,
}: {
  order: CancelSheetOrder
  onCancelled: (orderId: string) => void
}) {
  // Email: identitas pertama. Diisi dari cookie bila ada (pembeli yang checkout di device ini);
  // tetap bisa diubah, dan wajib diisi bila cookie kosong.
  const [email, setEmail] = useState(() => getGuestEmail())
  const [phone, setPhone] = useState('') // identitas kedua, TIDAK pernah di-prefill
  const [honeypot, setHoneypot] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false) // true → tombol "Ya, Batalkan" muncul
  const [cancelling, setCancelling] = useState(false)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setError('Email tidak valid. Contoh: nama@gmail.com')
      return
    }
    if (!isValidPhone(phone)) {
      setError('Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.')
      return
    }
    setVerifying(true)
    setError('')
    setVerified(false)
    try {
      const res = await fetch('/api/orders/verify-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.orderId, phone, website: honeypot }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Gagal memverifikasi. Coba lagi.')
      } else if (!data.match) {
        setError('Nomor telepon tidak cocok dengan pesanan ini. Periksa kembali.')
      } else if (!data.cancellable) {
        setError(`Pesanan berstatus "${data.status}" tidak dapat dibatalkan.`)
      } else {
        setVerified(true)
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setVerifying(false)
    }
  }

  // Eksekusi pembatalan — klik eksplisit, tidak pernah otomatis setelah verifikasi.
  async function handleCancel() {
    if (cancelling) return
    setCancelling(true)
    setError('')
    try {
      const res = await fetch('/api/orders/cancel-by-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          email: normalizeEmail(email),
          phone,
          website: honeypot,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Termasuk email yang tak cocok dengan pesanan (server memeriksanya di sini, SEC-037).
        setError(data.error ?? 'Gagal membatalkan pesanan.')
        setVerified(false) // paksa verifikasi ulang bila gagal (mis. status berubah)
      } else {
        onCancelled(order.orderId)
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setCancelling(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary'

  return (
    <div className="overflow-y-auto px-5 py-4">
      {/* Ringkasan pesanan yang akan dibatalkan */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <p className="font-bold text-gray-900">{fmtInvoice(order.orderId)}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {formatShortDate(order.date)} · {order.status}
        </p>
        {order.items.length > 0 && (
          <div className="mt-3 space-y-2.5 border-t border-dashed border-zinc-200 pt-3">
            {order.items.map((it) => (
              <div key={it.productId} className="flex items-center gap-3">
                <div className="relative h-10 w-10 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-white">
                  <Image src={it.imageUrl || PLACEHOLDER} alt={it.name} fill unoptimized sizes="40px" className="object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-semibold text-zinc-900">{it.name}</p>
                  <p className="text-xs text-zinc-400">{it.quantity}× item</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Konfirmasi kepemilikan: email + no_telepon pesanan */}
      <p className="mt-4 text-sm text-gray-600">
        Masukkan email dan nomor telepon yang Anda pakai pada pesanan ini. Pembatalan tidak bisa
        dibatalkan kembali, jadi kami memastikannya lewat dua data pesanan.
      </p>
      <form onSubmit={handleVerify} className="mt-3 space-y-3">
        <HoneypotField id="website-batal" value={honeypot} onChange={setHoneypot} />
        <div>
          <label htmlFor="cancelEmail" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="cancelEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="nama@gmail.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError('')
              setVerified(false)
            }}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="confirmPhone" className="mb-1 block text-sm font-medium text-gray-700">
            Nomor Telepon
          </label>
          <input
            id="confirmPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="08xxxxxxxxxx"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, '').slice(0, 12))
              setError('')
              setVerified(false)
            }}
            className={inputCls}
          />
        </div>
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-rose-600">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {!verified && (
          <button
            type="submit"
            disabled={verifying}
            className="w-full rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
          >
            {verifying ? 'Memverifikasi…' : 'Verifikasi Nomor'}
          </button>
        )}
      </form>

      {verified && (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="mr-1 inline h-4 w-4" /> Nomor cocok. Pesanan dapat dibatalkan.
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition hover:bg-rose-700 active:scale-[0.99] disabled:opacity-50"
          >
            <Ban className="h-4 w-4" />
            {cancelling ? 'Membatalkan…' : 'Ya, Batalkan Pesanan'}
          </button>
        </div>
      )}
      {/* Ruang napas di bawah supaya tombol tak menempel tepi layar HP */}
      <div className="h-4" />
    </div>
  )
}
