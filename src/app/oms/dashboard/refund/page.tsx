'use client'

// src/app/oms/dashboard/refund/page.tsx
// Daftar kerja pengembalian dana: pesanan LUNAS yang dibatalkan, uangnya masih di kita.
//
// ── Kenapa halaman tersendiri, bukan tab di Pesanan ──
// Ini bukan cara lain melihat pesanan — ini daftar PEKERJAAN yang belum selesai, dan yang
// dicari darinya berbeda: siapa yang menunggu, sudah berapa lama, dan lewat jalur mana uangnya
// harus dikirim. Ditempel sebagai tab di halaman Pesanan, ia akan tenggelam di antara filter
// tanggal, kurir, dan gudang yang tak satu pun relevan di sini.
//
// ── Kenapa jalur pembayaran ditonjolkan ──
// Terverifikasi 2026-09-10: pembayaran lewat transfer bank TIDAK BISA di-refund Xendit sama
// sekali — pengembaliannya transfer manual ke rekening pembeli, dan CS harus meminta nomor
// rekeningnya lewat chat. E-wallet bisa kembali ke sumbernya. Dua prosedur yang sangat berbeda,
// dan yang menentukan hanyalah kolom metode bayar — jadi ia dibuat mencolok, bukan sekadar ada.

import { useCallback, useEffect, useState } from 'react'
import { Wallet, Landmark, HelpCircle, Loader2, Inbox, RefreshCw } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import { paymentMethodInfo, paymentMethodLabel } from '@/lib/payment-method'
import type { Order } from '@/types/order'

// Berapa lama pesanan ini sudah menunggu dikembalikan, dalam hari.
function hariMenunggu(iso: string): number {
  const ms = Date.now() - Date.parse(iso)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0
}

function formatTanggal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(d)
}

// Petunjuk jalur pengembalian berdasarkan metode bayar. Inilah kalimat pertama yang perlu dibaca
// admin sebelum menyentuh apa pun.
function jalurPengembalian(order: Order): {
  Icon: typeof Wallet
  warna: string
  judul: string
  langkah: string
} {
  const info = paymentMethodInfo(order.paymentMethod)

  if (!info) {
    return {
      Icon: HelpCircle,
      warna: 'text-gray-600 bg-gray-50 border-gray-200',
      judul: 'Metode bayar tak tercatat',
      langkah:
        'Pesanan lama sebelum kolom metode bayar ada. Cek transaksinya di dashboard Xendit dulu untuk memastikan jalurnya sebelum mengirim apa pun.',
    }
  }

  if (info.family === 'transfer-bank') {
    return {
      Icon: Landmark,
      warna: 'text-amber-700 bg-amber-50 border-amber-200',
      judul: `${info.channel} — transfer manual`,
      langkah:
        'Xendit TIDAK BISA me-refund transfer bank. Minta nama bank, nomor rekening, dan nama pemiliknya lewat WhatsApp, lalu kirim dari dashboard Xendit. Cocokkan nama pemilik rekening dengan nama pemesan.',
    }
  }

  return {
    Icon: Wallet,
    warna: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    judul: `${info.channel} — kembali ke sumber`,
    langkah:
      'Dana bisa dikembalikan ke dompet/kartu asal lewat dashboard Xendit. Tidak perlu meminta nomor rekening.',
  }
}

// Pengambilan data murni — tidak menyentuh state sama sekali, supaya bisa dipanggil dari effect
// maupun dari penangan tombol tanpa keduanya menduplikasi penanganan galatnya.
async function ambilRefunds(): Promise<{ orders?: Order[]; error?: string }> {
  try {
    const res = await fetch('/api/oms/refunds', { cache: 'no-store' })
    const data = (await res.json()) as { orders?: Order[]; error?: string }
    if (!res.ok) return { error: data.error ?? 'Gagal memuat daftar pengembalian dana.' }
    return { orders: data.orders ?? [] }
  } catch {
    return { error: 'Terjadi kesalahan jaringan. Coba lagi.' }
  }
}

export default function RefundPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Baris yang sedang dibuka formnya. Sengaja SATU, bukan banyak: menutup baris refund adalah
  // pernyataan bahwa uang sudah dikirim, dan membuka beberapa sekaligus mengundang salah tempel.
  const [openId, setOpenId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Pemuatan pertama. Sengaja TIDAK memanggil setState secara sinkron di badan effect (dan
  // membatalkan diri saat komponen dilepas) — pola yang sama dipakai NotificationBell.
  useEffect(() => {
    let active = true
    ambilRefunds().then((hasil) => {
      if (!active) return
      if (hasil.error) setError(hasil.error)
      else setOrders(hasil.orders ?? [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  // Pemuatan ulang atas permintaan (tombol, atau setelah satu baris ditutup). Ini penangan
  // peristiwa, bukan effect, jadi bebas mengubah state sesukanya.
  const muatUlang = useCallback(async () => {
    setLoading(true)
    setError('')
    const hasil = await ambilRefunds()
    if (hasil.error) setError(hasil.error)
    else setOrders(hasil.orders ?? [])
    setLoading(false)
  }, [])

  function buka(order: Order) {
    setOpenId(order.orderId)
    // Nominal diisi awal dengan total pesanan — jumlah yang benar pada kasus paling umum, dan
    // admin tinggal mengurangi bila biaya transfer dipotong.
    setAmount(String(order.totalAmount))
    setNote('')
    setFormError('')
  }

  async function tutup(orderId: string, status: 'SUDAH_REFUND' | 'TIDAK_PERLU') {
    setFormError('')
    if (note.trim().length < 3) {
      setFormError(
        status === 'SUDAH_REFUND'
          ? 'Isi catatan: rekening tujuan atau nomor referensi transfer.'
          : 'Isi alasan mengapa tidak perlu dikembalikan.',
      )
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/oms/refunds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          status,
          note: note.trim(),
          ...(status === 'SUDAH_REFUND' ? { amount: Number(amount) || 0 } : {}),
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setFormError(data.error ?? 'Gagal menyimpan.')
        return
      }
      setOpenId(null)
      await muatUlang()
    } catch {
      setFormError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  const totalTertahan = orders.reduce((sum, o) => sum + o.totalAmount, 0)

  return (
    <>
      <OmsHeader title="Pengembalian Dana" />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        {/* === Ringkasan === */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">Pesanan lunas yang dibatalkan dan dananya belum dikembalikan</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {orders.length} pesanan
              {orders.length > 0 && (
                <span className="ml-2 text-base font-semibold text-amber-700">
                  · {formatRupiah(totalTertahan)} tertahan
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void muatUlang()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Muat ulang
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-gray-100 bg-white py-16 text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Memuat…
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white py-16 text-center">
            <Inbox className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-semibold text-gray-700">Tidak ada yang menunggu</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Setiap pesanan lunas yang dibatalkan akan muncul di sini sampai dananya dikembalikan.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => {
              const jalur = jalurPengembalian(order)
              const hari = hariMenunggu(order.date)
              const terbuka = openId === order.orderId

              return (
                <li
                  key={order.orderId}
                  className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-emerald-700">#{order.orderId}</p>
                      <p className="mt-0.5 text-sm text-gray-900">{order.customerName}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {order.customerPhone ?? '—'}
                        {order.customerEmail ? ` · ${order.customerEmail}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-900">
                        {formatRupiah(order.totalAmount)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Dipesan {formatTanggal(order.date)}
                        {hari > 0 && (
                          <span className={hari >= 3 ? 'font-semibold text-amber-700' : ''}>
                            {' '}· {hari} hari lalu
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {paymentMethodLabel(order.paymentMethod) ?? 'Metode tak tercatat'}
                      </p>
                    </div>
                  </div>

                  {/* Jalur pengembalian — kalimat pertama yang perlu dibaca admin */}
                  <div className={`mt-3 rounded-lg border p-3 ${jalur.warna}`}>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <jalur.Icon className="h-4 w-4 flex-none" />
                      {jalur.judul}
                    </p>
                    <p className="mt-1 pl-6 text-xs leading-relaxed opacity-90">{jalur.langkah}</p>
                  </div>

                  {!terbuka ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => buka(order)}
                        className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Catat pengembalian
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3.5">
                      <label className="block text-xs font-semibold text-gray-600">
                        Nominal yang dikembalikan
                        <input
                          type="number"
                          min={0}
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>
                      <p className="mt-1 text-[11px] text-gray-500">
                        Kurangi bila biaya transfer dipotong. Nilai pesanan{' '}
                        {formatRupiah(order.totalAmount)}.
                      </p>

                      <label className="mt-3 block text-xs font-semibold text-gray-600">
                        Catatan (wajib)
                        <textarea
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Bank & no. rekening tujuan, atau nomor referensi transfer"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>

                      {formError && (
                        <p role="alert" className="mt-2 text-xs text-red-600">
                          {formError}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenId(null)}
                          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-100"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => void tutup(order.orderId, 'TIDAK_PERLU')}
                          disabled={saving}
                          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
                        >
                          Tidak perlu dikembalikan
                        </button>
                        <button
                          type="button"
                          onClick={() => void tutup(order.orderId, 'SUDAH_REFUND')}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                          Sudah saya kirim
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
