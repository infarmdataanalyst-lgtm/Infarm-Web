'use client'

// src/app/oms/dashboard/notifikasi/page.tsx
// Daftar lengkap notifikasi OMS dengan paginasi — tujuan tautan "Lihat Semua" di panel lonceng.
//
// Ditaruh di BAWAH /oms/dashboard (bukan /notifikasi di root) karena guard sesi di proxy.ts
// memakai matcher '/oms/dashboard/:path*'. Halaman notifikasi di luar prefix itu akan terbuka
// untuk siapa pun tanpa login, padahal isinya memuat nama pembeli & nilai pesanan.
//
// Data dari GET /api/notifications (paginasi lewat limit/offset) — API Route, bukan server action,
// sesuai pola OMS lain.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, MessageSquare, PackageX, ShoppingCart } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'

type NotificationType = 'pesanan_baru' | 'stok_habis' | 'ulasan_baru'

type NotificationItem = {
  id: string
  type: NotificationType
  title: string
  message: string
  href: string
  createdAt: string | null
  unread: boolean
}

const PAGE_SIZE = 20

// Tanggal + jam lengkap (zona perangkat admin). Berbeda dari panel dropdown yang memakai waktu
// relatif: di halaman riwayat, waktu persis lebih berguna daripada "3 hari lalu".
function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NotifikasiPage() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (targetPage: number) => {
    setLoading(true)
    try {
      const offset = (targetPage - 1) * PAGE_SIZE
      const res = await fetch(`/api/notifications?limit=${PAGE_SIZE}&offset=${offset}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setError('Gagal memuat notifikasi.')
        return
      }
      const data = (await res.json()) as { items?: NotificationItem[]; total?: number }
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
      setError('')
    } catch {
      setError('Gagal memuat notifikasi. Periksa koneksi lalu coba lagi.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Pemuatan dijadwalkan lewat timer 0ms, BUKAN dipanggil langsung di badan efek: lint
  // `react-hooks/set-state-in-effect` melarang setState sinkron di dalam efek.
  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(page), 0)
    return () => window.clearTimeout(kickoff)
  }, [load, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <>
      <OmsHeader title="Notifikasi" />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">Semua Notifikasi</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pesanan yang menunggu diproses dan produk yang kehabisan stok. Daftar ini dihitung dari
            keadaan terkini, sehingga notifikasi hilang sendiri begitu pesanan diproses atau stok
            diisi ulang.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {loading && <p className="px-4 py-10 text-center text-sm text-gray-500">Memuat…</p>}

          {!loading && error && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-600">{error}</p>
              <button
                type="button"
                onClick={() => void load(page)}
                className="mt-2 text-sm font-semibold text-brand-primary hover:underline"
              >
                Coba lagi
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-gray-500">
              Tidak ada notifikasi. Semua pesanan sudah diproses dan stok aman.
            </p>
          )}

          {!loading &&
            !error &&
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => router.push(n.href)}
                className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-4 text-left transition last:border-b-0 hover:bg-gray-50 ${
                  n.unread ? 'bg-emerald-50/40' : ''
                }`}
              >
                <span
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${
                    n.type === 'stok_habis'
                      ? 'bg-red-50 text-red-600'
                      : n.type === 'ulasan_baru'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {n.type === 'stok_habis' ? (
                    <PackageX className="h-4 w-4" aria-hidden />
                  ) : n.type === 'ulasan_baru' ? (
                    <MessageSquare className="h-4 w-4" aria-hidden />
                  ) : (
                    <ShoppingCart className="h-4 w-4" aria-hidden />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{n.title}</span>
                  <span className="block text-sm text-gray-600">{n.message}</span>
                </span>

                <span className="hidden flex-none text-xs text-gray-400 sm:block">
                  {formatDateTime(n.createdAt)}
                </span>

                {n.unread && (
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand-primary"
                  />
                )}
              </button>
            ))}
        </div>

        {/* Paginasi — disembunyikan bila semuanya muat di satu halaman */}
        {!loading && !error && total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Menampilkan {from}–{to} dari {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium text-gray-700">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
