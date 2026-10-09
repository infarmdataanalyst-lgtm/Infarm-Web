'use client'

// src/components/track/TrackOrderActions.tsx
// Aksi pembatalan di halaman DETAIL pesanan (/track): tautan "Batalkan pesanan" yang membuka
// CancelOrderSheet, atau jalur WhatsApp CS bila paketnya sudah dijadwalkan kurir.
//
// ── Kenapa di sini, bukan di daftar Pesanan Saya ──
// Keputusan pemilik 2026-10-09: tombol batal yang besar di tiap kartu daftar justru mengajak
// pembeli membatalkan. Di halaman detail, di bawah blok pembayaran dan di atas alamat, ia tetap
// mudah ditemukan oleh yang memang mencarinya — tanpa menonjol bagi yang tidak.
//
// ── Aksinya mengikuti aturan server ──
// evaluateBuyerCancel adalah fungsi yang SAMA dengan yang dipakai /api/orders/verify-cancel dan
// cancel-by-phone. Kalau komponen ini menebak sendiri, pembeli bisa menekan tombol yang pasti
// ditolak server.
//
// Setelah pembatalan berhasil, halaman (Server Component) dimuat ulang lewat router.refresh()
// supaya badge status, stepper, dan blok pembayaran mengikuti keadaan baru dari database.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban } from 'lucide-react'
import { evaluateBuyerCancel } from '@/lib/order-cancellation'
import { waCancelRequestLink } from '@/lib/data/contact'
import WhatsAppIcon from '@/components/ui/WhatsAppIcon'
import CancelOrderSheet, { type CancelSheetOrder } from '@/components/pesanan-saya/CancelOrderSheet'

export default function TrackOrderActions({
  order,
  trackingNumber,
  shipmentStatus,
}: {
  order: CancelSheetOrder
  trackingNumber?: string | null
  shipmentStatus?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const verdict = evaluateBuyerCancel({ status: order.status, trackingNumber, shipmentStatus })

  // Sudah terkirim / sudah dibatalkan: tak ada yang perlu ditawarkan.
  if (!verdict.ok && verdict.code !== 'NEEDS_CS') return null

  function handleCancelled() {
    setOpen(false)
    setToast('Pesanan berhasil dibatalkan. Stok produk telah dikembalikan.')
    router.refresh()
  }

  return (
    <>
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        {verdict.ok ? (
          // Sengaja tampil sebagai baris teks + tautan, bukan tombol penuh: tersedia, tidak mengajak.
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-gray-500">
              Pesanan belum diproses kurir, masih bisa dibatalkan.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 active:scale-[0.98]"
            >
              <Ban className="h-3.5 w-3.5" />
              Batalkan pesanan
            </button>
          </div>
        ) : (
          // NEEDS_CS: keputusannya pindah ke CS yang bisa memeriksa apakah paket sudah dijemput.
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-gray-600">{verdict.message}</p>
            {(() => {
              const waLink = waCancelRequestLink(order.orderId)
              return waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-sm font-semibold text-white transition hover:brightness-95 active:scale-[0.99]"
                >
                  <WhatsAppIcon />
                  Ajukan Pembatalan lewat WhatsApp
                </a>
              ) : (
                // Nomor CS belum dikonfigurasi: katakan terus terang, jangan tampilkan tombol mati.
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                  Hubungi admin kami untuk mengajukan pembatalan, sertakan nomor pesanan{' '}
                  <strong>{order.orderId.startsWith('#') ? order.orderId : `#${order.orderId}`}</strong>.
                </p>
              )
            })()}
          </div>
        )}
      </section>

      <CancelOrderSheet order={open ? order : null} onClose={() => setOpen(false)} onCancelled={handleCancelled} />

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-[90] mx-auto max-w-md rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  )
}
