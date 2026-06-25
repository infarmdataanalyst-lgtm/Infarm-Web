// src/components/checkout/OrderSummary.tsx
// Ringkasan pesanan: subtotal, biaya pengiriman, diskon (hijau), dan total akhir.
// Nilai dihitung di parent agar konsisten dengan sticky bottom bar.

import { formatRupiah } from '@/lib/format'

// Menampilkan rincian biaya pesanan beserta total akhir.
// shipping = null bila kurir belum dipilih → tampilkan ajakan memilih kurir.
export default function OrderSummary({
  subtotal,
  shipping,
  discount,
  total,
}: {
  subtotal: number
  shipping: number | null
  discount: number
  total: number
}) {
  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-bold text-zinc-800">Ringkasan Pesanan</h2>

      <dl className="space-y-2 text-sm">
        <Row label="Subtotal" value={formatRupiah(subtotal)} />
        {shipping === null ? (
          <Row
            label="Ongkos Kirim"
            value="Pilih kurir terlebih dahulu"
            valueClassName="text-zinc-400"
          />
        ) : (
          <Row label="Ongkos Kirim" value={formatRupiah(shipping)} />
        )}
        {/* Diskon ditampilkan hijau dengan tanda minus */}
        <Row label="Diskon" value={`- ${formatRupiah(discount)}`} valueClassName="text-brand-primary" />

        <div className="my-2 border-t border-dashed border-zinc-200" />

        <div className="flex items-center justify-between">
          <dt className="text-base font-bold text-zinc-800">Total</dt>
          <dd className="text-base font-bold text-zinc-900">{formatRupiah(total)}</dd>
        </div>
      </dl>
    </section>
  )
}

// Satu baris label–nilai pada ringkasan
function Row({
  label,
  value,
  valueClassName = 'text-zinc-800',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={valueClassName}>{value}</dd>
    </div>
  )
}
