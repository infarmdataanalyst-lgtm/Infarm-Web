'use client'

// src/app/checkout/success/PayNowButton.tsx
// Tombol "Bayar Sekarang" di halaman sukses — menerbitkan ulang tagihan Xendit lalu membawa
// pembeli ke halaman pembayarannya.
//
// Kenapa perlu ada: penerbitan tagihan bisa gagal (Xendit down, konfigurasi belum lengkap), dan
// pembeli bisa saja menutup halaman pembayaran tanpa menyelesaikannya. Tanpa tombol ini, pesanan
// yang sudah tersimpan — DAN STOKNYA SUDAH DIPOTONG — tak punya jalan untuk dibayar sama sekali.
//
// Aman dipanggil berulang: endpoint menolak pesanan yang sudah Lunas atau Dibatalkan, dan
// rate limit per-invoice membatasi jumlah tagihan yang bisa diterbitkan untuk satu pesanan.

import { useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'

export default function PayNowButton({ invoice }: { invoice: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handlePay() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/payments/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice }),
      })
      const data = (await res.json().catch(() => ({}))) as { invoiceUrl?: string; error?: string }

      if (res.ok && data.invoiceUrl) {
        // FULL redirect — tujuannya domain Xendit, di luar aplikasi ini.
        window.location.replace(data.invoiceUrl)
        return
      }
      setError(data.error ?? 'Gagal membuat halaman pembayaran. Silakan coba lagi.')
    } catch {
      setError('Gagal menghubungi server. Periksa koneksi lalu coba lagi.')
    } finally {
      // Sengaja tetap dimatikan walau berhasil: bila redirect di atas gagal karena alasan apa pun,
      // tombolnya harus bisa ditekan lagi alih-alih membeku dalam keadaan memuat.
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handlePay}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 font-heading text-sm font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Menyiapkan pembayaran…
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            Bayar Sekarang
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
