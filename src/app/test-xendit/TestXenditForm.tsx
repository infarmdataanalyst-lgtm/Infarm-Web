'use client'

// src/app/test-xendit/TestXenditForm.tsx
// Formulir halaman uji Xendit: pilih pesanan + bank → panggil POST /api/payments/create →
// tampilkan Virtual Account yang terbit. DEVELOPMENT ONLY (penjagaannya di page.tsx).
//
// Komponen ini TIDAK pernah menyentuh Xendit langsung — ia hanya memanggil route handler internal.
// Itu memang seluruh maksud pemisahannya: XENDIT_SECRET_KEY tak boleh ada di bundel browser.

import { useState } from 'react'
import { formatRupiah } from '@/lib/format'

type TestOrder = {
  invoice: string
  customerName: string
  totalAmount: number
  date: string
}

type VirtualAccount = {
  paymentRequestId: string
  bank: string
  accountNumber: string
  amount: number
  expiresAt: string
  status: string
}

export default function TestXenditForm({
  orders,
  methods,
}: {
  orders: TestOrder[]
  methods: string[]
}) {
  // Input manual disediakan karena daftar hanya memuat 30 pesanan terakhir yang belum dibayar —
  // pesanan lain tetap bisa diuji dengan menempelkan nomor invoicenya.
  const [invoice, setInvoice] = useState(orders[0]?.invoice ?? '')
  const [method, setMethod] = useState(methods[0] ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [va, setVa] = useState<VirtualAccount | null>(null)
  const [savedToDb, setSavedToDb] = useState<boolean | null>(null)

  async function handleSubmit() {
    setLoading(true)
    setError('')
    setVa(null)
    setSavedToDb(null)
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: invoice.trim(), method }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : `Gagal (HTTP ${res.status})`)
        return
      }
      setVa(data.va as VirtualAccount)
      setSavedToDb(Boolean(data.transactionSaved))
    } catch {
      setError('Gagal menghubungi server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {/* Pilih pesanan */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <label htmlFor="order" className="block text-sm font-semibold text-zinc-800">
          Pesanan (belum dibayar)
        </label>
        {orders.length > 0 ? (
          <select
            id="order"
            value={orders.some((o) => o.invoice === invoice) ? invoice : ''}
            onChange={(e) => setInvoice(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— pilih / isi manual di bawah —</option>
            {orders.map((o) => (
              <option key={o.invoice} value={o.invoice}>
                {o.invoice} · {o.customerName} · {formatRupiah(o.totalAmount)}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Tidak ada pesanan berstatus Menunggu Pembayaran. Buat satu lewat checkout lebih dulu.
          </p>
        )}

        <label htmlFor="invoice" className="mt-4 block text-sm font-semibold text-zinc-800">
          atau isi nomor invoice manual
        </label>
        <input
          id="invoice"
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          placeholder="INV-20260821-MW2S47ZX"
          className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </section>

      {/* Pilih bank */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-800">Bank Virtual Account</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium uppercase transition ${
                method === m
                  ? 'border-brand-primary bg-brand-surface text-brand-primary'
                  : 'border-zinc-300 text-zinc-600 hover:border-brand-light'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !invoice.trim() || !method}
        className="w-full rounded-xl bg-brand-primary py-3 text-base font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Memanggil Xendit…' : 'Buat Virtual Account (memanggil Xendit)'}
      </button>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
          <p className="mt-2 text-xs text-rose-600">
            Pesan detail teknisnya sengaja tidak dikirim ke browser — lihat terminal dev server
            untuk baris <code>[payments-create]</code>.
          </p>
        </div>
      )}

      {va && (
        <section className="rounded-xl border border-brand-primary bg-white p-4">
          <h2 className="text-sm font-bold text-zinc-900">Virtual Account terbit</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Bank" value={va.bank} />
            <Row label="Nomor VA" value={va.accountNumber} mono />
            <Row label="Jumlah" value={formatRupiah(va.amount)} />
            <Row label="Kedaluwarsa" value={new Date(va.expiresAt).toLocaleString('id-ID')} />
            <Row label="Status Xendit" value={va.status} />
            <Row label="Payment Request ID" value={va.paymentRequestId} mono />
            <Row
              label="Tersimpan ke id_transaksi"
              value={savedToDb ? 'ya' : 'TIDAK — cek log server'}
            />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            Langkah berikutnya: bayar VA ini di simulator Xendit (Dashboard → Test → Simulate
            payment). Callback akan masuk ke <code>/api/webhooks/xendit</code>, pesanan menjadi
            Lunas, dan booking kurir J&amp;T ikut terpicu.
          </p>
        </section>
      )}
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right text-zinc-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
