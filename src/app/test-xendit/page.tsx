// src/app/test-xendit/page.tsx
// Halaman uji pembuatan Virtual Account Xendit. **DEVELOPMENT ONLY** — BUKAN bagian dari checkout.
//
// ⚠️ DUA LAPIS PENJAGAAN, mengikuti pola /api/dev/simulate-payment:
//   1. NODE_ENV !== 'development' → notFound() (404, bukan halaman "akses ditolak"). Di production
//      halaman ini harus TIDAK ADA wujudnya; halaman penolakan justru mengonfirmasi keberadaannya.
//   2. requireAdmin() lewat getAdminIdentity() → hanya admin OMS yang sudah login. Tanpa ini,
//      siapa pun di jaringan lokal (atau preview deployment yang lupa NODE_ENV) bisa menerbitkan
//      Virtual Account atas pesanan orang lain.
//
// Server Component sebagai pembungkus penjagaan; formulirnya komponen klien terpisah.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getAdminIdentity } from '@/lib/oms-guard'
import { readOrders } from '@/lib/mock-db/orders'
import { supportedVaMethodIds } from '@/lib/xendit/payment-request'
import TestXenditForm from './TestXenditForm'

export const metadata: Metadata = {
  title: 'Uji Xendit (development)',
  // Halaman internal — jangan pernah diindeks walau sempat terekspos.
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function TestXenditPage() {
  // Lapis 1
  if (process.env.NODE_ENV !== 'development') notFound()

  // Lapis 2
  const admin = await getAdminIdentity()
  if (!admin) notFound()

  // Pesanan yang MASIH bisa dibayar — hanya ini yang berguna untuk diuji, dan menyaringnya di sini
  // mencegah percobaan yang pasti ditolak endpoint (409 "sudah dibayar"/"sudah dibatalkan").
  const orders = (await readOrders())
    .filter((o) => o.paymentStatus === 'Menunggu' && o.status !== 'Dibatalkan')
    .slice(0, 30)
    .map((o) => ({
      invoice: o.orderId,
      customerName: o.customerName,
      totalAmount: o.totalAmount,
      date: o.date,
    }))

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl bg-brand-surface px-4 py-8">
      <div className="rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 p-4">
        <h1 className="text-lg font-bold text-orange-900">Halaman Uji Xendit — Development Only</h1>
        <p className="mt-1 text-sm leading-relaxed text-orange-800">
          Halaman ini <strong>bukan</strong> bagian dari alur checkout dan tidak ada di production
          (404). Menekan tombol di bawah <strong>benar-benar memanggil API Xendit</strong> dan
          menerbitkan Virtual Account atas pesanan yang dipilih. Pastikan{' '}
          <code className="rounded bg-orange-100 px-1">XENDIT_SECRET_KEY</code> yang terpasang adalah{' '}
          <strong>kunci test</strong> (<code className="rounded bg-orange-100 px-1">xnd_development_…</code>)
          — kunci live akan ditolak penjaga lingkungan di{' '}
          <code className="rounded bg-orange-100 px-1">lib/xendit/config.ts</code>.
        </p>
        <p className="mt-2 text-xs text-orange-700">Masuk sebagai: {admin.name}</p>
      </div>

      <TestXenditForm orders={orders} methods={supportedVaMethodIds()} />
    </main>
  )
}
