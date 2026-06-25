'use client'

// src/components/checkout/ShippingOptions.tsx
// Pemilihan kurir & ongkir (Mengantar) lewat pola bottom sheet (seperti PaymentModal):
// tombol trigger menampilkan kurir terpilih → klik membuka bottom sheet berisi daftar kurir
// (radio card, termurah→termahal, unsupported disembunyikan) → "Konfirmasi" menyimpan pilihan.
// Cek ongkir tetap otomatis di-fetch saat alamat tujuan / berat berubah.

import { useEffect, useMemo, useState } from 'react'
import { Truck, ChevronRight, Loader2, AlertTriangle, Check, X } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import BottomSheet from '@/components/checkout/BottomSheet'
import { fetchShippingEstimate, type ShippingCourier } from '@/lib/mengantar'

// Menampilkan tombol trigger + bottom sheet pemilihan kurir.
// onSelect dipanggil saat buyer menekan "Konfirmasi" (bukan saat sekadar memilih card).
export default function ShippingOptions({
  destinationId,
  weight,
  selected,
  onSelect,
}: {
  destinationId: string
  weight: number
  selected: ShippingCourier | null
  onSelect: (courier: ShippingCourier | null) => void
}) {
  const [couriers, setCouriers] = useState<ShippingCourier[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const [open, setOpen] = useState(false)
  const [draftId, setDraftId] = useState('') // pilihan sementara di dalam sheet (belum dikonfirmasi)

  // === Fetch ongkir otomatis saat alamat tujuan / berat berubah (atau "Coba lagi") ===
  useEffect(() => {
    if (!destinationId) return
    const ctrl = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const list = await fetchShippingEstimate(destinationId, weight, ctrl.signal)
        if (ctrl.signal.aborted) return
        setCouriers(list)
      } catch {
        if (!ctrl.signal.aborted) {
          setError('Gagal memuat ongkos kirim, silakan coba lagi')
          setCouriers([])
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => ctrl.abort()
  }, [destinationId, weight, retry])

  // Hanya kurir yang melayani tujuan, diurutkan dari ongkir termurah
  const supported = useMemo(
    () => couriers.filter((c) => !c.unsupported).sort((a, b) => a.price - b.price),
    [couriers],
  )

  const disabled = !destinationId
  const draftValid = supported.some((c) => c.id === draftId)

  // Buka sheet dengan pilihan awal = kurir yang sudah dikonfirmasi (bila ada)
  function openSheet() {
    setDraftId(selected?.id ?? '')
    setOpen(true)
  }

  // Simpan pilihan & tutup sheet
  function handleConfirm() {
    const courier = supported.find((c) => c.id === draftId)
    if (courier) onSelect(courier)
    setOpen(false)
  }

  const triggerValue = selected
    ? `${selected.name} — ${formatRupiah(selected.price)} (${selected.estimatedDate})`
    : 'Pilih Kurir Pengiriman'

  return (
    <>
      {/* === Tombol trigger (pola seperti OptionRow) === */}
      <button
        type="button"
        onClick={openSheet}
        disabled={disabled}
        title={disabled ? 'Pilih alamat pengiriman terlebih dahulu' : undefined}
        className="flex w-full items-center gap-3 bg-white px-4 py-4 text-left transition active:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="shrink-0 text-brand-primary">
          <Truck className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500">Metode Pengiriman</p>
          <p className={`truncate text-sm font-semibold ${selected ? 'text-zinc-800' : 'text-zinc-400'}`}>
            {triggerValue}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
      </button>

      {/* === Bottom sheet pilihan kurir === */}
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        {/* Header: judul + tombol silang */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="text-base font-bold text-zinc-800">Pilih Kurir Pengiriman</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Tutup" className="p-1 active:scale-95">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body scrollable: skeleton / error / empty / daftar kurir */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <SkeletonList />
          ) : error ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-start gap-2 text-orange-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                <p className="text-sm">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="mt-3 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:brightness-90"
              >
                Coba Lagi
              </button>
            </div>
          ) : supported.length === 0 ? (
            <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-4 text-sm text-orange-800">
              Belum ada kurir tersedia ke alamat tujuan.
            </p>
          ) : (
            <ul className="space-y-2" role="radiogroup" aria-label="Pilihan kurir">
              {supported.map((courier) => {
                const active = courier.id === draftId
                return (
                  <li key={courier.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDraftId(courier.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-brand-primary bg-brand-surface ring-1 ring-brand-primary'
                          : 'border-zinc-200 bg-white hover:border-brand-light'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                          active ? 'border-brand-primary bg-brand-primary text-white' : 'border-zinc-300'
                        }`}
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-800">{courier.name}</p>
                        <p className="text-xs text-zinc-500">Estimasi tiba: {courier.estimatedDate}</p>
                      </div>
                      <p className="flex-none text-sm font-bold text-brand-primary">
                        {formatRupiah(courier.price)}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer: tombol Konfirmasi (nonaktif bila belum ada pilihan valid) */}
        <div className="shrink-0 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!draftValid}
            className="w-full rounded-xl bg-brand-primary py-3 text-base font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Konfirmasi
          </button>
        </div>
      </BottomSheet>
    </>
  )
}

// Skeleton 3 kartu saat ongkir sedang dimuat
function SkeletonList() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
        Menghitung ongkos kirim…
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
          <div className="h-5 w-5 flex-none animate-pulse rounded-full bg-zinc-100" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-24 animate-pulse rounded bg-zinc-100" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-zinc-100" />
          </div>
          <div className="h-4 w-16 flex-none animate-pulse rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  )
}
