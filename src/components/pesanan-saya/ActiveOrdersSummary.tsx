'use client'

// src/components/pesanan-saya/ActiveOrdersSummary.tsx
// Refresh AKURAT jumlah pesanan aktif saat halaman "Pesanan Saya" dibuka:
// baca no_telepon dari cookie → query server (/api/orders/track-by-phone) → hitung pesanan aktif
// (status BUKAN "Selesai"/"Dibatalkan") → perbarui cookie estimasi (infarm_active_orders) agar badge
// header ikut akurat → tampilkan teks ringkas. Tanpa cookie phone → tak menampilkan apa pun.

import { useEffect, useState } from 'react'
import { getGuestPhone, setActiveOrderCount } from '@/lib/guest-phone'
import { isValidPhone } from '@/lib/phone'

// Status yang dianggap SUDAH selesai/tak aktif (label Indonesia dari data layer)
const INACTIVE_STATUSES = new Set(['Selesai', 'Dibatalkan'])

export default function ActiveOrdersSummary() {
  const [count, setCount] = useState<number | null>(null) // null = belum tahu (loading / tak ada phone)

  useEffect(() => {
    const phone = getGuestPhone()
    if (!phone || !isValidPhone(phone)) return // belum pernah checkout di device ini → tak tampil

    const controller = new AbortController()
    fetch('/api/orders/track-by-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, website: '' }), // honeypot kosong (permintaan sah)
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { orders: [] }))
      .then((data: { orders?: { status: string }[] }) => {
        const active = (data.orders ?? []).filter((o) => !INACTIVE_STATUSES.has(o.status)).length
        setCount(active)
        setActiveOrderCount(active) // refresh cookie → badge header jadi akurat
      })
      .catch(() => {
        // Abort / error jaringan → biarkan badge apa adanya (jangan tampilkan teks)
      })
    return () => controller.abort()
  }, [])

  if (count === null || count <= 0) return null

  return (
    <p className="mb-4 rounded-xl bg-brand-light/30 px-4 py-2.5 text-sm font-semibold text-brand-primary">
      Anda memiliki {count} pesanan aktif
    </p>
  )
}
