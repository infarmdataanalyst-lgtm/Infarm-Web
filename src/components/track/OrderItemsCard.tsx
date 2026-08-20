// src/components/track/OrderItemsCard.tsx
// Kartu "Produk Dipesan" di halaman Lacak Pesanan — supaya pembeli langsung tahu pesanan MANA yang
// sedang ia lacak, tanpa harus mengingat isi nota.
//
// Server Component (tanpa 'use client'): murni tampilan, tak ada state maupun event.
//
// Sumber data: `Order.items` yang SUDAH di-resolve getOrderByOrderId (order_items → products untuk
// nama & foto, product_variants untuk nama varian). Komponen ini TIDAK query apa pun.
//
// Harga yang ditampilkan = `item.price`, yaitu snapshot `order_items.price_at_purchase` saat
// checkout — BUKAN harga produk saat ini. Harga katalog bisa sudah berubah setelah pesanan dibuat;
// menampilkannya akan membuat angka di halaman ini tak cocok dengan yang dibayar pembeli.

import Image from 'next/image'
import { formatRupiah } from '@/lib/format'
import type { Order, OrderItem } from '@/types/order'

// Menghitung subtotal barang dari snapshot harga.
// Item hadiah promo (`isPromoItem`) DIKECUALIKAN: harganya 0 dan memang tak menambah subtotal
// (lihat docs/checkout-flow.md → promo & combo), jadi menjumlahkannya hanya menyesatkan.
function subtotalOf(items: OrderItem[]): number {
  return items.reduce((sum, it) => (it.isPromoItem ? sum : sum + it.price * it.quantity), 0)
}

// Menampilkan daftar produk yang dibeli beserta ringkasan biayanya.
export default function OrderItemsCard({ order }: { order: Order }) {
  const subtotal = subtotalOf(order.items)
  const totalQty = order.items.reduce((sum, it) => sum + it.quantity, 0)

  // Ongkir TIDAK disimpan sebagai kolom tersendiri di tabel orders — `jumlah_total` sudah memuat
  // ongkir dikurangi diskon. Jadi selisih inilah satu-satunya angka yang jujur bisa ditampilkan;
  // ia tak bisa dipecah menjadi "ongkir" dan "diskon" secara terpisah.
  // Selisih negatif (diskon lebih besar dari ongkir) diberi label "Diskon" agar tak muncul
  // "Ongkos kirim -Rp5.000" yang membingungkan.
  const difference = order.totalAmount - subtotal
  const courierLabel = [order.logistics?.courier, order.logistics?.service]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      {/* Nomor invoice & tanggal SENGAJA tidak diulang di sini — keduanya sudah tampil di kartu
          identitas pesanan tepat di atas kartu ini (src/app/track/page.tsx). */}
      <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-zinc-200 pb-4">
        <h2 className="text-sm font-bold text-gray-900">Produk Dipesan</h2>
        <p className="shrink-0 text-xs text-gray-400">
          {order.items.length} jenis · {totalQty} item
        </p>
      </div>

      {/* Daftar produk. Foto 56px di mobile, 72px di lg+ (desktop lebih lega — lihat catatan
          layout dua kolom di src/app/track/page.tsx). */}
      {order.items.length > 0 ? (
        <ul className="divide-y divide-zinc-100">
          {order.items.map((item) => (
            <li
              key={`${item.productId}-${item.variantId ?? ''}-${item.isPromoItem ? 'promo' : 'buy'}`}
              className="flex items-start gap-3 py-3 lg:gap-4"
            >
              <div
                className={`relative h-14 w-14 flex-none overflow-hidden rounded-lg border bg-zinc-50 lg:h-18 lg:w-18 ${
                  item.isPromoItem ? 'border-brand-light' : 'border-zinc-100'
                }`}
              >
                {/* unoptimized mengikuti pola kartu produk lain (keranjang & halaman sukses):
                    next.config belum mendaftarkan remotePatterns untuk Supabase Storage. */}
                <Image
                  src={item.imageUrl || '/images/product-placeholder.png'}
                  alt={item.name}
                  fill
                  unoptimized
                  sizes="72px"
                  className="object-cover"
                />
              </div>

              <div className="min-w-0 flex-1">
                {/* line-clamp-2, bukan truncate: nama produk katalog ini panjang dan satu baris
                    terpotong di tengah kata. JANGAN tambahkan `block` — line-clamp butuh
                    `display: -webkit-box` dan `block` menimpanya. */}
                <p
                  className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900"
                  title={item.name}
                >
                  {item.isPromoItem ? `🎁 ${item.name}` : item.name}
                </p>
                {item.variantName && (
                  <p className="mt-0.5 truncate text-xs font-medium text-brand-primary">
                    Varian: {item.variantName}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {item.isPromoItem
                    ? 'Bonus Promo'
                    : `${item.quantity} × ${formatRupiah(item.price)}`}
                </p>
              </div>

              {/* Harga total baris. Item promo tertulis "Gratis", bukan Rp0 polos. */}
              <span className="shrink-0 text-sm font-bold text-brand-primary lg:text-base">
                {item.isPromoItem ? 'Gratis' : formatRupiah(item.price * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-gray-400">Rincian produk tidak tersedia.</p>
      )}

      {/* Ringkasan biaya */}
      <dl className="space-y-2 border-t border-dashed border-zinc-200 pt-4 text-sm">
        <Row label="Subtotal Produk" value={formatRupiah(subtotal)} />
        {difference !== 0 && (
          <Row
            label={difference > 0 ? 'Ongkos Kirim & Biaya Lain' : 'Diskon'}
            value={
              difference > 0
                ? formatRupiah(difference)
                : `- ${formatRupiah(Math.abs(difference))}`
            }
            valueClassName={difference > 0 ? 'text-zinc-800' : 'text-brand-primary'}
          />
        )}
        {courierLabel && <Row label="Pengiriman" value={courierLabel} />}

        <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
          <dt className="text-base font-bold text-gray-900">Total Pembayaran</dt>
          <dd className="text-base font-bold text-brand-primary lg:text-lg">
            {formatRupiah(order.totalAmount)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// Satu baris label–nilai pada ringkasan (pola sama dengan OrderSummary di checkout).
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
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right ${valueClassName}`}>{value}</dd>
    </div>
  )
}
