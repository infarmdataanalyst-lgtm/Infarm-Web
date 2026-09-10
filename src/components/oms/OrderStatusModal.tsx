'use client'

// src/components/oms/OrderStatusModal.tsx
// Modal detail + update status pesanan (OMS). Opsi status dibatasi state machine
// (order-status-machine.ts); field ekspedisi/layanan/resi hanya muncul & wajib saat 'Dikirim'.
// Menyimpan lewat PATCH /api/orders/update-status (validasi ulang di server).

import { useState } from 'react'
import { X, Loader2, Package, AlertTriangle, Truck } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { nextStatuses, isFinalStatus } from '@/lib/order-status-machine'
import { paymentMethodLabel } from '@/lib/payment-method'
import type { Order, OrderFulfillmentStatus } from '@/types/order'

type OrderStatusModalProps = {
  order: Order
  onClose: () => void
  onUpdated: (order: Order) => void // dipanggil setelah update sukses (untuk refresh tabel + toast)
}

// Satu pekerjaan manual yang tersisa setelah pembatalan tersimpan. `detail` adalah pesan mentah
// dari pihak ketiga — ditampilkan apa adanya karena itulah yang berguna saat admin harus
// menjelaskannya ke Mengantar atau Xendit.
type PostCancelIssue = { judul: string; penjelasan: string; detail: string }

// Bentuk laporan tindakan pihak ketiga di respons PATCH /api/orders/update-status.
type ThirdPartyReport = {
  attempted: boolean
  ok?: boolean
  reason?: string
  detail?: string
}

// Modal update status untuk satu pesanan.
export default function OrderStatusModal({ order, onClose, onUpdated }: OrderStatusModalProps) {
  const current = order.status ?? 'Menunggu Pembayaran'
  const options = nextStatuses(current)
  const final = isFinalStatus(current)

  // Status terpilih (default = tetap di status sekarang; admin harus memilih perubahan)
  const [status, setStatus] = useState<OrderFulfillmentStatus>(current)
  // Prefill field logistik dari data order (bila sudah ada)
  const [courier, setCourier] = useState(order.logistics?.courier ?? '')
  const [service, setService] = useState(order.logistics?.service ?? '')
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Tindakan pihak ketiga yang GAGAL setelah pembatalan tersimpan. Selama daftar ini tak kosong,
  // modal sengaja TIDAK ditutup — lihat handleSave.
  //
  // Berupa DAFTAR, bukan satu nilai: pembatalan menyentuh dua pihak ketiga sekaligus (menghapus
  // penjemputan di Mengantar, mematikan tagihan di Xendit) dan keduanya bisa gagal pada pembatalan
  // yang sama. Menampilkan hanya yang pertama akan menyembunyikan pekerjaan manual yang kedua.
  const [issues, setIssues] = useState<PostCancelIssue[]>([])
  // Pesanan yang sudah tersimpan, ditahan sampai admin menutup peringatan di atas.
  const [savedOrder, setSavedOrder] = useState<Order | null>(null)

  const requiresShipping = status === 'Dikirim'
  const changed = status !== current
  const invoice = order.orderId.startsWith('#') ? order.orderId : `#${order.orderId}`

  // Resi yang SUDAH tersimpan pada pesanan (bukan isian form di atas) — itulah yang menentukan
  // apakah kurir sudah punya perintah jemput.
  const bookedAwb = order.trackingNumber?.trim() || ''
  const isBooked = Boolean(bookedAwb) || order.shipmentStatus === 'BOOKED'

  // Membatalkan pesanan yang kurirnya sudah dibooking kini IKUT menghapus penjemputannya di
  // Mengantar — server yang melakukannya, di dalam permintaan yang sama (update-status/route.ts).
  //
  // Sampai 2026-09-09 blok ini berupa CENTANG WAJIB berbunyi "saya sudah membatalkan di dashboard
  // Mengantar": sebuah JANJI admin, karena saat itu tak ada cara memanggil pembatalan dari kode.
  // Setelah DELETE /order tersambung, janji itu jadi salah — dan centang yang menyuruh orang
  // melakukan sesuatu yang sudah dikerjakan sistem hanya mengajari admin mengabaikan peringatan.
  //
  // Yang menggantikannya: keterangan apa yang AKAN terjadi sebelum menyimpan, lalu hasilnya
  // ditampilkan setelah menyimpan. Peringatan yang menuntut tindakan hanya muncul bila
  // penghapusannya benar-benar gagal.
  const willCancelPickup = status === 'Dibatalkan' && isBooked

  function handleStatusChange(next: OrderFulfillmentStatus) {
    setStatus(next)
    setError('')
  }

  // Menutup peringatan kegagalan: barulah pesanan yang sudah tersimpan diteruskan ke daftar
  // (yang sekaligus menutup modal ini).
  function acknowledgeFailure() {
    if (savedOrder) onUpdated(savedOrder)
  }

  async function handleSave() {
    setError('')
    // Guard client (server tetap validasi ulang)
    if (!changed) {
      setError('Pilih status baru terlebih dahulu.')
      return
    }
    if (requiresShipping && (!courier.trim() || !service.trim() || !trackingNumber.trim())) {
      setError('Nama ekspedisi, jenis layanan, dan no resi wajib diisi untuk status Dikirim.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/orders/update-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          status,
          ...(requiresShipping
            ? { courier: courier.trim(), service: service.trim(), trackingNumber: trackingNumber.trim() }
            : {}),
        }),
      })
      const data = (await res.json()) as {
        order?: Order
        error?: string
        shipmentCancellation?: ThirdPartyReport
        invoiceExpiry?: ThirdPartyReport
      }
      if (!res.ok || !data.order) {
        setError(data.error ?? 'Gagal memperbarui status pesanan.')
        return
      }

      // Pembatalannya SUDAH tersimpan di server pada titik ini — status, stok, dan mutasinya.
      // Yang mungkin gagal hanyalah dua tindakan ke pihak ketiga. Karena itu modal DITAHAN, bukan
      // dibatalkan: satu-satunya jejak lain dari kegagalan ini adalah kolom database yang tak
      // pernah dibuka siapa pun, sementara akibatnya berjalan terus di dunia nyata.
      const gagal: PostCancelIssue[] = []

      const pickup = data.shipmentCancellation
      if (pickup?.attempted && pickup.ok === false) {
        gagal.push({
          judul: 'Penjemputan kurir BELUM dibatalkan',
          penjelasan: `Buka dashboard Mengantar dan hapus pengiriman${bookedAwb ? ` beresi ${bookedAwb}` : ''} secara manual. Kalau tidak, kurir tetap datang menjemput paket ini sementara stoknya sudah dikembalikan.`,
          detail: `${pickup.reason ?? 'unknown'}${pickup.detail ? `: ${pickup.detail}` : ''}`,
        })
      }

      const tagihan = data.invoiceExpiry
      if (tagihan?.attempted && tagihan.ok === false) {
        gagal.push({
          judul: 'Tagihan Xendit MASIH BISA DIBAYAR',
          penjelasan:
            'Matikan tagihannya manual di dashboard Xendit. Kalau pembeli terlanjur membayarnya lewat transfer bank, uangnya TIDAK BISA dikembalikan lewat Xendit — harus ditransfer manual ke rekening pembeli.',
          detail: `${tagihan.reason ?? 'unknown'}${tagihan.detail ? `: ${tagihan.detail}` : ''}`,
        })
      }

      if (gagal.length > 0) {
        setSavedOrder(data.order)
        setIssues(gagal)
        return
      }

      onUpdated(data.order)
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button type="button" aria-label="Tutup modal" onClick={onClose} className="absolute inset-0 bg-gray-900/50" />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-lg font-bold text-gray-900">Detail Pesanan</h3>
          <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body (scroll) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* === Ringkasan order === */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">No. Invoice</dt>
            <dd className="text-right font-semibold text-emerald-700">{invoice}</dd>
            <dt className="text-gray-500">Customer</dt>
            <dd className="text-right font-medium text-gray-900">{order.customerName}</dd>
            <dt className="text-gray-500">Total</dt>
            <dd className="text-right font-semibold text-gray-900">{formatRupiah(order.totalAmount)}</dd>
            {/* Metode bayar HANYA muncul untuk pesanan yang sudah lunas.
                Di sinilah CS berada saat membatalkan pesanan, dan inilah pertanyaan pertama yang
                menentukan langkah berikutnya: transfer bank menuntut CS meminta nomor rekening
                (Xendit tak bisa me-refund VA sama sekali), sedangkan e-wallet/QRIS/kartu bisa
                dikembalikan ke sumbernya. Pada pesanan yang belum dibayar tak ada uang yang perlu
                dikembalikan, jadi barisnya sengaja tidak ditampilkan.
                "Belum tercatat" DITAMPILKAN, bukan disembunyikan: pesanan lunas sebelum
                2026-08-28 tak punya nilai ini, dan CS perlu tahu bahwa jalur pengembaliannya harus
                dipastikan lewat dashboard Xendit — bukan diasumsikan transfer bank. */}
            {order.paymentStatus === 'Lunas' && (
              <>
                <dt className="text-gray-500">Metode Bayar</dt>
                <dd className="text-right font-medium text-gray-900">
                  {paymentMethodLabel(order.paymentMethod) ?? (
                    <span className="text-gray-400">Belum tercatat</span>
                  )}
                </dd>
              </>
            )}
          </dl>

          {/* Item pesanan */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Item Pesanan</p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {order.items.length === 0 ? (
                <li className="px-3 py-3 text-sm text-gray-400">Tidak ada item.</li>
              ) : (
                order.items.map((item, i) => (
                  <li key={`${item.productId}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Package className="h-4 w-4 shrink-0 text-gray-300" />
                      <span className="truncate text-gray-700">{item.name}</span>
                      <span className="shrink-0 text-gray-400">×{item.quantity}</span>
                    </span>
                    <span className="shrink-0 font-medium text-gray-900">{formatRupiah(item.price * item.quantity)}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* === Status pesanan === */}
          <div className="mt-5">
            <label htmlFor="order-status" className="mb-1.5 block text-sm font-semibold text-gray-700">
              Status Pesanan
            </label>
            {final ? (
              // Status final → read-only
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                Status <span className="font-semibold text-gray-700">{current}</span> bersifat final dan tidak dapat diubah.
              </div>
            ) : (
              <select
                id="order-status"
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as OrderFulfillmentStatus)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                {/* Opsi pertama = pertahankan status sekarang */}
                <option value={current}>{current} (saat ini)</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* === Field pengiriman (hanya saat 'Dikirim') === */}
          {requiresShipping && (
            <div className="mt-4 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <p className="text-xs font-semibold text-emerald-700">Data Pengiriman (wajib diisi)</p>
              <div>
                <label htmlFor="courier" className="mb-1 block text-xs font-medium text-gray-600">
                  Nama Ekspedisi <span className="text-red-500">*</span>
                </label>
                <input
                  id="courier"
                  type="text"
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                  placeholder="mis. JNE, SiCepat"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              <div>
                <label htmlFor="service" className="mb-1 block text-xs font-medium text-gray-600">
                  Jenis Layanan <span className="text-red-500">*</span>
                </label>
                <input
                  id="service"
                  type="text"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder="mis. Reguler, YES"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              <div>
                <label htmlFor="tracking" className="mb-1 block text-xs font-medium text-gray-600">
                  No. Resi <span className="text-red-500">*</span>
                </label>
                <input
                  id="tracking"
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="mis. JX1234567890"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>
          )}

          {/* === Apa yang akan terjadi pada penjemputannya (sebelum menyimpan) === */}
          {willCancelPickup && issues.length === 0 && (
            <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3.5">
              <p className="flex items-start gap-2 text-sm font-semibold text-sky-900">
                <Truck className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                  Penjemputan kurir ikut dibatalkan
                  {bookedAwb && (
                    <>
                      {' '}
                      — resi <span className="font-mono">{bookedAwb}</span>
                    </>
                  )}
                </span>
              </p>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-sky-800">
                Pengirimannya dihapus di Mengantar dan ongkos kirimnya kembali ke saldo. Bila
                penghapusan gagal — misalnya paketnya sudah keburu dijemput — pembatalan pesanan
                tetap berlaku dan Anda akan diberi tahu di sini.
              </p>
            </div>
          )}

          {/* === Tindakan pihak ketiga yang GAGAL — butuh penanganan manual === */}
          {issues.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3.5">
              <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                  Pesanan sudah dibatalkan, tapi ada {issues.length === 1 ? 'satu hal' : `${issues.length} hal`}{' '}
                  yang harus Anda selesaikan manual.
                </span>
              </p>
              <ul className="mt-2.5 space-y-3 pl-6">
                {issues.map((issue) => (
                  <li key={issue.judul}>
                    <p className="text-xs font-semibold text-amber-900">{issue.judul}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                      {issue.penjelasan}
                    </p>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-amber-700">
                      {issue.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pesan error */}
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        {/* Footer aksi */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
          {issues.length > 0 ? (
            // Perubahannya SUDAH tersimpan; satu-satunya jalan keluar adalah mengakui peringatan
            // di atas. Tombol "Batal" sengaja tidak ditampilkan — tak ada lagi yang bisa dibatalkan,
            // dan menawarkannya hanya menyarankan bahwa peringatan itu boleh diabaikan.
            <button
              type="button"
              onClick={acknowledgeFailure}
              className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              Mengerti, saya tangani manual
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Batal
              </button>
              {!final && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !changed}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
