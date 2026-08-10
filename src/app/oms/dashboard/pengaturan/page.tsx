'use client'

// src/app/oms/dashboard/pengaturan/page.tsx
// Halaman Pengaturan Toko OMS. Saat ini berisi satu setting: minimum total belanja
// (store_settings.min_order_amount) — batas bawah subtotal barang agar order bisa di-checkout.
//
// Kenapa perlu: payment gateway punya batas minimum transaksi (Xendit ±Rp10.000) dan ongkir
// bersifat tetap per order, sehingga order bernilai sangat kecil gagal dibuat / merugi.
// Nilainya diatur admin (bukan konstanta di kode) supaya bisa diubah tanpa deploy ulang.
//
// Operasi data via API Route /api/settings/min-order (bukan server action) — sesuai pola OMS lain.

import { useEffect, useState } from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'

export default function PengaturanPage() {
  const [amount, setAmount] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // Muat nilai tersimpan
  useEffect(() => {
    let active = true
    fetch('/api/settings/min-order')
      .then((res) => res.json())
      .then((data: { minOrderAmount?: number }) => {
        if (active && typeof data.minOrderAmount === 'number') setAmount(data.minOrderAmount)
      })
      .catch(() => {
        if (active) setError('Gagal memuat pengaturan.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Auto-sembunyikan toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleSave() {
    if (amount === '' || amount < 0) {
      setError('Isi nilai minimum yang valid.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/min-order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minOrderAmount: Number(amount) }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        minOrderAmount?: number
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan pengaturan.')
        return
      }
      if (typeof data.minOrderAmount === 'number') setAmount(data.minOrderAmount)
      setToast('Pengaturan tersimpan.')
    } catch {
      setError('Gagal menyimpan pengaturan. Periksa koneksi lalu coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <OmsHeader title="Pengaturan" />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Minimum Total Belanja</h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            Pembeli tidak bisa melanjutkan ke pembayaran bila subtotal barang (belum termasuk
            ongkir) masih di bawah nilai ini.
          </p>

          <div className="mt-4">
            <label htmlFor="min-order" className="mb-1.5 block text-sm font-medium text-gray-700">
              Minimum Total Belanja (Rp)
            </label>
            <input
              id="min-order"
              type="text"
              inputMode="numeric"
              value={amount}
              disabled={loading || saving}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                setAmount(digits === '' ? '' : Number(digits))
                setError('')
              }}
              placeholder={loading ? 'Memuat…' : '15000'}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50"
            />
            {amount !== '' && (
              <p className="mt-1 text-xs font-medium text-emerald-700">{formatRupiah(Number(amount))}</p>
            )}
            {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
          </div>

          {/* Konteks angka: kenapa jangan terlalu rendah */}
          <div className="mt-4 flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-relaxed text-orange-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Disarankan minimal {formatRupiah(15000)}. Payment gateway menolak transaksi di bawah
              ±{formatRupiah(10000)}, dan diskon promo masih bisa menurunkan total tagihan setelah
              subtotal terpenuhi.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving || amount === ''}
            className="mt-5 rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>

      {/* Toast sukses */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          {toast}
        </div>
      )}
    </>
  )
}
