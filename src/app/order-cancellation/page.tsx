// src/app/order-cancellation/page.tsx
// Halaman Pembatalan Pesanan untuk pembeli Guest. Di luar route group (store) → tanpa AppBar,
// punya header hijau sendiri (seperti halaman checkout/keranjang).
// Server Component tipis: membaca query (id/order_id + token) lalu menyerahkan ke client view
// yang menangani validasi, loading, form, dan transisi ke state sukses.

import type { Metadata } from 'next'
import OrderCancellationView from '@/components/order-cancellation/OrderCancellationView'

export const metadata: Metadata = {
  title: 'Pembatalan Pesanan — infarm.id',
  description: 'Batalkan pesanan Anda di infarm.id selama belum masuk tahap pengemasan.',
}

export default async function OrderCancellationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; order_id?: string; token?: string }>
}) {
  const params = await searchParams
  // Terima `id` (contoh tautan) maupun `order_id` agar fleksibel
  const orderId = params.id ?? params.order_id ?? ''
  const token = params.token ?? ''

  return <OrderCancellationView orderId={orderId} token={token} />
}
