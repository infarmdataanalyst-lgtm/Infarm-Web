'use client'

// src/app/cancel-order/page.tsx
// Batalkan Pesanan — 2 LANGKAH, DUA IDENTITAS BERBEDA.
//   LANGKAH 1: cari pesanan by EMAIL (auto-recognize cookie), tampil RINGKAS → pilih satu.
//   LANGKAH 2: KETIK no_telepon pesanan itu (konfirmasi kepemilikan, TIDAK di-prefill) → verifikasi
//              ke DB (server query ulang) → bila cocok & masih boleh dibatalkan → tombol
//              "Ya, Batalkan Pesanan".
// Honeypot mencegah bot; rate limit ada di tiap endpoint (lihat @/lib/rate-limit).
//
// ── Kenapa langkah 1 pindah dari no_telepon ke email ──
// Menyamakan mekanisme pencarian dengan /track-order supaya pembeli tak perlu mengingat identitas
// mana yang dipakai halaman mana. Pola pencariannya disalin persis dari halaman itu, termasuk
// endpoint yang dipakai: /api/orders/track-by-email.
//
// ── Kenapa langkah 2 TETAP no_telepon, bukan ikut jadi email ──
// Justru karena langkah 1 sudah email. Kalau keduanya email, konfirmasi kedua tak menambah apa pun
// — orang yang lolos langkah 1 otomatis lolos langkah 2. Dengan telepon, pembatalan menuntut DUA
// data berbeda dari pesanan yang sama, dan itulah yang membuat langkah ini berarti untuk aksi yang
// tak bisa dibatalkan. Pencocokannya dilakukan SERVER (query ulang ke DB), dua kali dan saling
// bebas: sekali di /api/orders/verify-cancel, sekali lagi di /api/orders/cancel-by-phone yang
// tidak mempercayai hasil verifikasi sebelumnya.
//
// ── Pesanan tanpa email tak akan muncul ──
// orders.email baru terisi sejak field email kembali ke checkout. Pesanan lama ber-email NULL
// tidak bisa ditemukan dari sini sama sekali, dan itu memang disengaja.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Search, Ban, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getGuestEmail } from '@/lib/guest-email'
import { isValidEmail, normalizeEmail } from '@/lib/email'
import { isValidPhone } from '@/lib/phone'

type PublicTrackOrder = {
  orderId: string
  status: string
  paymentStatus: string
  trackingNumber: string | null
  courier: string | null
  date: string
  customerNameMasked: string
  items: { name: string; quantity: number; imageUrl: string | null }[]
}

type Step = 'search' | 'confirm' | 'done'

export default function CancelOrderPage() {
  const [step, setStep] = useState<Step>('search')

  // Langkah 1
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [orders, setOrders] = useState<PublicTrackOrder[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // true = email dikenali dari cookie → sembunyikan form & email di langkah 1, langsung tampilkan hasil.
  const [recognized, setRecognized] = useState(false)

  // Langkah 2
  const [selected, setSelected] = useState<PublicTrackOrder | null>(null)
  const [confirmPhone, setConfirmPhone] = useState('') // identitas kedua, TIDAK pernah di-prefill
  const [confirmHoneypot, setConfirmHoneypot] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [verified, setVerified] = useState(false) // true → tombol "Ya, Batalkan" muncul
  const [cancelling, setCancelling] = useState(false)

  // === LANGKAH 1: cari pesanan ===
  const runSearch = useCallback(async (searchEmail: string, hp: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orders/track-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: searchEmail, website: hp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Gagal mencari pesanan. Coba lagi.')
        setOrders(null)
      } else {
        setOrders(data.orders ?? [])
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.')
      setOrders(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-recognize: cookie `infarm_email` ada & sah → isi + auto-cari (langkah 1 saja).
  // Cookie ini TIDAK berlaku untuk langkah 2 — konfirmasi telepon harus selalu diketik manual.
  useEffect(() => {
    const saved = getGuestEmail()
    if (saved && isValidEmail(saved)) {
      setEmail(saved)
      setRecognized(true) // sembunyikan email & form langkah 1 — langsung tampilkan hasil
      runSearch(normalizeEmail(saved), '')
    }
  }, [runSearch])

  // Klik "Cari email lain": tampilkan kembali form kosong (email cookie TIDAK ditampilkan/di-prefill)
  function handleUseOtherEmail() {
    setRecognized(false)
    setEmail('')
    setOrders(null)
    setError('')
  }

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value)
    setError('')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setError('Email tidak valid. Contoh: nama@gmail.com')
      return
    }
    // Dinormalisasi sebelum dikirim supaya cocok dengan bentuk yang tersimpan di orders.email.
    // Server menormalkannya lagi — sengaja, agar pemanggil lain pun tak bisa lolos tanpa itu.
    runSearch(normalizeEmail(email), honeypot)
  }

  // Pilih satu pesanan → ke langkah 2 (reset state konfirmasi)
  function pickOrder(order: PublicTrackOrder) {
    setSelected(order)
    setConfirmPhone('')
    setConfirmHoneypot('')
    setVerified(false)
    setVerifyError('')
    setStep('confirm')
  }

  // === LANGKAH 2: verifikasi no_telepon (query ulang DB) ===
  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    if (!isValidPhone(confirmPhone)) {
      setVerifyError('Nomor telepon tidak valid. Gunakan format 08xxxxxxxxxx.')
      return
    }
    setVerifying(true)
    setVerifyError('')
    setVerified(false)
    try {
      const res = await fetch('/api/orders/verify-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selected.orderId, phone: confirmPhone, website: confirmHoneypot }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyError(data.error ?? 'Gagal memverifikasi. Coba lagi.')
      } else if (!data.match) {
        setVerifyError('Nomor telepon tidak cocok dengan pesanan ini. Periksa kembali.')
      } else if (!data.cancellable) {
        setVerifyError(`Pesanan berstatus "${data.status}" tidak dapat dibatalkan.`)
      } else {
        setVerified(true) // cocok & boleh dibatalkan → tombol "Ya, Batalkan" muncul
      }
    } catch {
      setVerifyError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setVerifying(false)
    }
  }

  // Eksekusi pembatalan (klik eksplisit, tak auto-cancel)
  async function handleCancel() {
    if (!selected || cancelling) return
    setCancelling(true)
    setVerifyError('')
    try {
      // Email ikut dikirim dan diverifikasi ulang server terhadap orders.email (SEC-037).
      // Sebelumnya hanya orderId + phone yang dikirim, sehingga sifat "dua identitas" pada alur
      // ini cuma ada di UI — endpointnya sendiri tak pernah menuntut email.
      const res = await fetch('/api/orders/cancel-by-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selected.orderId,
          email: normalizeEmail(email),
          phone: confirmPhone,
          website: confirmHoneypot,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyError(data.error ?? 'Gagal membatalkan pesanan.')
        setVerified(false) // paksa verifikasi ulang bila gagal (mis. status berubah)
      } else {
        setStep('done')
      }
    } catch {
      setVerifyError('Terjadi kesalahan jaringan. Coba lagi.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand */}
      <header className="fixed inset-x-0 top-0 z-50 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/pesanan-saya" aria-label="Kembali" className="rounded-md p-1 transition active:scale-95">
            <BackIcon />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo-infarm.png" alt="Logo Infarm" width={32} height={32} priority unoptimized className="h-8 w-auto object-contain" />
            <span className="text-xl font-bold tracking-tight">Batalkan Pesanan</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {/* === LANGKAH 1: cari === */}
        {step === 'search' && (
          <>
            {/* === Email dikenali dari cookie: sembunyikan form & email, langsung tampilkan hasil === */}
            {recognized ? (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-600">
                  Menampilkan pesanan untuk email Anda ·{' '}
                  <button
                    type="button"
                    onClick={handleUseOtherEmail}
                    className="font-semibold text-brand-primary underline transition hover:no-underline"
                  >
                    Cari email lain
                  </button>
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h1 className="text-xl font-bold text-gray-900">Cari Pesanan</h1>
                <p className="mt-2 text-sm text-gray-500">
                  Masukkan email yang Anda gunakan saat checkout untuk menemukan pesanan yang ingin dibatalkan.
                </p>
                <form onSubmit={handleSearch} className="mt-5 space-y-3">
                  <Honeypot value={honeypot} onChange={setHoneypot} />
                  <div>
                    <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      spellCheck={false}
                      placeholder="nama@gmail.com"
                      value={email}
                      onChange={handleEmailChange}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                    {error && <p className="mt-1.5 text-sm text-rose-600">{error}</p>}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
                  >
                    <Search className="h-4 w-4" />
                    {loading ? 'Mencari…' : 'Cari Pesanan'}
                  </button>
                </form>
              </div>
            )}

            {orders !== null && (
              <div className="mt-5 space-y-3">
                {orders.length === 0 ? (
                  <div className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center shadow-sm">
                    <p className="text-sm text-gray-400">Tidak ada pesanan untuk email ini.</p>
                    {/* Pesanan sebelum field email kembali ke checkout ber-email NULL dan tak akan
                        pernah muncul di sini. Untuk pesanan itu satu-satunya jalur pembatalan
                        mandiri adalah tautan bertoken yang dikirim saat checkout. */}
                    <p className="mt-2 text-xs text-gray-400">
                      Pesanan lama mungkin dibuat tanpa email. Pakai tautan pembatalan pada bukti
                      pesanan Anda, atau hubungi kami lewat WhatsApp.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="px-1 text-sm text-gray-500">Pilih pesanan yang ingin dibatalkan:</p>
                    {orders.map((o) => (
                      <OrderSummaryCard key={o.orderId} order={o} onPick={() => pickOrder(o)} />
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* === LANGKAH 2: konfirmasi === */}
        {step === 'confirm' && selected && (
          <div className="space-y-4">
            {/* Ringkas pesanan terpilih + detail produk */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-xs text-gray-500">Pesanan dipilih</p>
              <p className="mt-0.5 font-bold text-gray-900">{fmtInvoice(selected.orderId)}</p>
              <p className="mt-0.5 text-xs text-gray-400">{fmtDate(selected.date)} · {selected.status}</p>

              {/* Detail produk dalam pesanan (foto + nama + qty) — gaya seperti halaman sukses */}
              {selected.items.length > 0 && (
                <div className="mt-3 space-y-3 border-t border-dashed border-zinc-200 pt-3">
                  {selected.items.map((it, i) => (
                    <div key={`${it.name}-${i}`} className="flex items-center gap-3">
                      <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
                        <Image
                          src={it.imageUrl || '/images/product-placeholder.png'}
                          alt={it.name}
                          fill
                          unoptimized
                          sizes="44px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-semibold text-zinc-900">{it.name}</p>
                        <p className="text-xs text-zinc-400">{it.quantity}× item</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Konfirmasi kepemilikan lewat no_telepon — identitas KEDUA, bukan pengulangan
                langkah 1 yang memakai email. Lihat catatan di kepala berkas. */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-gray-900">Konfirmasi Kepemilikan</h2>
              <p className="mt-1 text-sm text-gray-500">
                Masukkan nomor telepon yang Anda pakai pada pesanan ini. Pembatalan tidak bisa
                dibatalkan kembali, jadi kami memastikannya lewat satu data lagi selain email.
              </p>
              <form onSubmit={handleVerify} className="mt-4 space-y-3">
                <Honeypot value={confirmHoneypot} onChange={setConfirmHoneypot} />
                <label htmlFor="confirmPhone" className="mb-1 block text-sm font-medium text-gray-700">
                  Nomor Telepon
                </label>
                <input
                  id="confirmPhone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="08xxxxxxxxxx"
                  value={confirmPhone}
                  onChange={(e) => {
                    setConfirmPhone(e.target.value.replace(/\D/g, '').slice(0, 12))
                    setVerifyError('')
                    setVerified(false)
                  }}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
                {verifyError && (
                  <p className="flex items-center gap-1.5 text-sm text-rose-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {verifyError}
                  </p>
                )}
                {!verified && (
                  <button
                    type="submit"
                    disabled={verifying}
                    className="w-full rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
                  >
                    {verifying ? 'Memverifikasi…' : 'Verifikasi Nomor'}
                  </button>
                )}
              </form>

              {/* Tombol batalkan hanya muncul setelah verifikasi cocok (klik eksplisit) */}
              {verified && (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <CheckCircle2 className="mr-1 inline h-4 w-4" /> Nomor cocok. Pesanan dapat dibatalkan.
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition hover:bg-rose-700 active:scale-[0.99] disabled:opacity-50"
                  >
                    <Ban className="h-4 w-4" />
                    {cancelling ? 'Membatalkan…' : 'Ya, Batalkan Pesanan'}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setStep('search')}
              className="w-full text-sm font-medium text-brand-primary transition hover:brightness-90"
            >
              ← Pilih pesanan lain
            </button>
          </div>
        )}

        {/* === Sukses === */}
        {step === 'done' && selected && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
              <Ban className="h-7 w-7 text-rose-600" />
            </span>
            <h1 className="mt-4 text-lg font-bold text-gray-900">Pesanan Dibatalkan</h1>
            <p className="mt-2 text-sm text-gray-500">
              Pesanan {fmtInvoice(selected.orderId)} berhasil dibatalkan. Stok produk telah dikembalikan.
            </p>
            <Link
              href="/pesanan-saya"
              className="mt-5 inline-block rounded-xl bg-brand-primary px-6 py-3 text-sm font-bold text-white transition hover:brightness-90"
            >
              Kembali ke Pesanan Saya
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

// === Sub-komponen ===

// Field honeypot tersembunyi (bot cenderung mengisinya)
function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="website">Website (jangan diisi)</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// Kartu ringkas pesanan di langkah 1 (info non-sensitif) + tombol pilih
function OrderSummaryCard({ order, onPick }: { order: PublicTrackOrder; onPick: () => void }) {
  const cancelled = order.status === 'Dibatalkan'
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-gray-900">{fmtInvoice(order.orderId)}</p>
          <p className="mt-0.5 text-xs text-gray-400">{fmtDate(order.date)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${cancelled ? 'bg-rose-50 text-rose-600' : 'bg-brand-light/40 text-brand-primary'}`}>
          {order.status}
        </span>
      </div>
      <button
        type="button"
        onClick={onPick}
        className="mt-3 w-full rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99]"
      >
        Pilih & Batalkan
      </button>
    </div>
  )
}

function fmtInvoice(id: string): string {
  return id.startsWith('#') ? id : `#${id}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
