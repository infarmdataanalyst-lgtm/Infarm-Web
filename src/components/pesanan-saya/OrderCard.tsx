'use client'

// src/components/pesanan-saya/OrderCard.tsx
// Kartu satu pesanan di halaman Pesanan Saya: info non-sensitif + AKSI yang sesuai keadaannya.
//
// ── Aksi ditentukan aturan yang sama dengan server ──
//   Batalkan   → evaluateBuyerCancel (dipakai juga /api/orders/verify-cancel & cancel-by-phone)
//   Beri Ulasan → order.review, dihitung server dari review-eligibility + tabel reviews
// Kalau kartu menebak sendiri, pembeli bisa menekan tombol yang pasti ditolak server — dan
// penolakan yang bisa diramalkan sejak awal adalah kegagalan desain, bukan keamanan.
//
// ── Badge "Beri Ulasan" sengaja kuning, bukan hijau ──
// Hijau sudah dipakai badge status (informasi). Kuning aksen hanya untuk hal yang MENUNGGU
// tindakan pembeli, supaya ia langsung tahu ada yang bisa dilakukan tanpa membaca teks.

import Link from 'next/link'
import { Ban, CheckCircle2, Package, Star } from 'lucide-react'
import type { PublicTrackOrder } from '@/types/public-order'
import { evaluateBuyerCancel } from '@/lib/order-cancellation'
import { fullyReviewed, needsReview } from '@/lib/buyer-orders'
import { waCancelRequestLink } from '@/lib/data/contact'
import WhatsAppIcon from '@/components/ui/WhatsAppIcon'

export default function OrderCard({
  order,
  onCancel,
  onReview,
}: {
  order: PublicTrackOrder
  onCancel: (order: PublicTrackOrder) => void
  onReview: (order: PublicTrackOrder) => void
}) {
  const cancelled = order.status === 'Dibatalkan'
  const itemSummary = order.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')
  const verdict = evaluateBuyerCancel(order)
  const reviewPending = needsReview(order)
  const reviewed = fullyReviewed(order)

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Nomor Pesanan</p>
          <p className="mt-0.5 font-bold text-gray-900">{fmtInvoice(order.orderId)}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {formatShortDate(order.date)} · {order.customerNameMasked}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              cancelled ? 'bg-rose-50 text-rose-600' : 'bg-brand-light/40 text-brand-primary'
            }`}
          >
            {order.status}
          </span>
          {/* Badge ajakan, sejajar badge status supaya terlihat tanpa scroll di dalam kartu */}
          {reviewPending && (
            <button
              type="button"
              onClick={() => onReview(order)}
              className="flex items-center gap-1 rounded-full bg-brand-accent px-3 py-1 text-xs font-bold text-brand-accent-ink shadow-sm transition hover:brightness-95 active:scale-95"
            >
              <Star className="h-3.5 w-3.5 fill-current" />
              Beri Ulasan
            </button>
          )}
        </div>
      </div>

      {/* Ringkasan barang */}
      <p className="mt-3 line-clamp-2 text-sm text-gray-600">{itemSummary || '—'}</p>

      {/* Kurir + resi */}
      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <Package className="h-4 w-4 text-brand-primary" />
        <span>{order.courier || 'Kurir belum ditentukan'}</span>
        {order.trackingNumber && <span className="font-mono text-gray-700">· {order.trackingNumber}</span>}
      </div>

      {/* === Keadaan ulasan (pesanan yang sudah final) === */}
      {reviewPending && (
        <button
          type="button"
          onClick={() => onReview(order)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-accent py-2.5 text-sm font-bold text-brand-accent-ink transition hover:brightness-95 active:scale-[0.99]"
        >
          <Star className="h-4 w-4 fill-current" />
          {order.review.reviewedCount > 0
            ? `Ulas ${order.review.pendingProductIds.length} produk lagi`
            : 'Beri Ulasan Produk'}
        </button>
      )}
      {reviewed && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
          <CheckCircle2 className="h-4 w-4" /> Sudah diulas
        </p>
      )}
      {/* Final, belum diulas semua, tapi tak boleh lagi: hanya untuk jendela yang sudah tutup.
          Pesanan dibatalkan tak perlu diberi tahu "tidak bisa diulas" — sudah jelas dari statusnya. */}
      {!reviewPending && !reviewed && order.review.blockCode === 'WINDOW_EXPIRED' && (
        <p className="mt-3 text-xs text-gray-400">Masa ulasan untuk pesanan ini sudah berakhir.</p>
      )}

      {/* === Pembatalan (pesanan aktif) === */}
      {verdict.ok && (
        <button
          type="button"
          onClick={() => onCancel(order)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99]"
        >
          <Ban className="h-4 w-4" />
          Batalkan Pesanan
        </button>
      )}
      {/* Sudah dijadwalkan kurir: keputusannya pindah ke CS. Hanya NEEDS_CS yang punya jalur
          pengajuan; pesanan terkirim/dibatalkan tak punya yang perlu diajukan. */}
      {!verdict.ok && verdict.code === 'NEEDS_CS' && (
        <div className="mt-3 space-y-2">
          <p className="rounded-xl bg-gray-50 px-3.5 py-2.5 text-xs leading-relaxed text-gray-600">
            {verdict.message}
          </p>
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
                <strong>{fmtInvoice(order.orderId)}</strong>.
              </p>
            )
          })()}
        </div>
      )}

      {/* Tautan ke detail perjalanan (halaman /track by invoice) */}
      <Link
        href={`/track?order=${encodeURIComponent(order.orderId)}`}
        className="mt-3 inline-block text-sm font-medium text-brand-primary transition hover:brightness-90"
      >
        Lihat detail perjalanan →
      </Link>
    </div>
  )
}

export function fmtInvoice(id: string): string {
  return id.startsWith('#') ? id : `#${id}`
}

// Format tanggal singkat: "22 Okt 2026"
export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}
