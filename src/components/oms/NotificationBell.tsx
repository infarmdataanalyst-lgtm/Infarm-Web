'use client'

// src/components/oms/NotificationBell.tsx
// Ikon lonceng + lencana jumlah belum dibaca + panel dropdown 10 notifikasi terbaru.
//
// KENAPA POLLING, BUKAN SUPABASE REALTIME: tabel `orders` & `products` RLS-aktif tanpa policy
// publik, dan browser admin hanya memegang anon key (autentikasi OMS memakai cookie HMAC sendiri,
// bukan Supabase Auth). Langganan postgres_changes karena itu tidak akan menerima satu baris pun.
// Membuatnya jalan menuntut service_role di browser — dilarang mutlak. Polling 60 detik + refetch
// saat tab kembali fokus memberi efek yang sama dengan biaya satu query ringan per menit.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, MessageSquare, PackageX, ShoppingCart } from 'lucide-react'

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

type NotificationResponse = {
  items?: NotificationItem[]
  total?: number
  unreadCount?: number
}

// Jeda polling. 60 detik dipilih karena notifikasi ini bersifat operasional (pesanan menunggu
// diproses), bukan real-time trading — lebih rapat hanya menambah beban tanpa mengubah keputusan.
const POLL_INTERVAL_MS = 60_000
const PANEL_LIMIT = 10

// Waktu relatif ringkas dalam Bahasa Indonesia. Sengaja tidak memakai Intl.RelativeTimeFormat
// karena butuh pembulatan "baru saja" dan format tanggal penuh untuk yang sudah lewat seminggu.
function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'

  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'baru saja'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} menit lalu`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} jam lalu`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} hari lalu`
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

// Ikon + warna per kategori notifikasi
function NotificationIcon({ type }: { type: NotificationType }) {
  // Ulasan baru yang belum dibalas (SEC-042) — warna amber, sengaja dibedakan dari merah
  // "stok habis" supaya admin bisa memilah antreannya sekilas tanpa membaca judulnya.
  if (type === 'ulasan_baru') {
    return (
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <MessageSquare className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  if (type === 'stok_habis') {
    return (
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-red-50 text-red-600">
        <PackageX className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  return (
    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
      <ShoppingCart className="h-4 w-4" aria-hidden />
    </span>
  )
}

export default function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?limit=${PANEL_LIMIT}`, { cache: 'no-store' })
      if (!res.ok) {
        setFailed(true)
        return
      }
      const data = (await res.json()) as NotificationResponse
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
      setUnread(data.unreadCount ?? 0)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Muat pertama + polling berkala.
  // Pemuatan pertama dijadwalkan lewat timer 0ms, BUKAN dipanggil langsung di badan efek: lint
  // `react-hooks/set-state-in-effect` melarang setState sinkron di dalam efek. Datanya memang
  // efek samping sesudah render, bukan state yang dibutuhkan pada render pertama.
  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => {
      window.clearTimeout(kickoff)
      window.clearInterval(timer)
    }
  }, [load])

  // Segarkan saat admin kembali ke tab — menutup jeda polling setelah lama ditinggal.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  // Tutup saat klik di luar / tekan Escape
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Membuka panel = menandai semua sudah dibaca. Lencana dinolkan seketika (optimistis) supaya
  // tak berkedip menunggu server; penanda `unread` pada tiap baris SENGAJA dibiarkan apa adanya
  // agar admin masih bisa melihat mana yang baru pada bukaan ini.
  function handleToggle() {
    const next = !open
    setOpen(next)
    if (!next || unread === 0) return
    setUnread(0)
    void fetch('/api/notifications/mark-read', { method: 'POST' }).catch(() => {
      // Gagal menandai tidak fatal: polling berikutnya akan memunculkan lencana lagi.
    })
  }

  // Klik notifikasi → tutup panel lalu navigasi ke halaman terkait.
  function handleItemClick(href: string) {
    setOpen(false)
    router.push(href)
  }

  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Daftar notifikasi"
          className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-bold text-gray-900">Notifikasi</p>
            <p className="text-xs text-gray-500">{total} total</p>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-center text-sm text-gray-500">Memuat…</p>}

            {!loading && failed && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-500">Gagal memuat notifikasi.</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 text-sm font-semibold text-brand-primary hover:underline"
                >
                  Coba lagi
                </button>
              </div>
            )}

            {!loading && !failed && items.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-gray-500">
                Tidak ada notifikasi. Semua pesanan sudah diproses dan stok aman.
              </p>
            )}

            {!loading &&
              !failed &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleItemClick(n.href)}
                  className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left transition last:border-b-0 hover:bg-gray-50 ${
                    n.unread ? 'bg-emerald-50/40' : ''
                  }`}
                >
                  <NotificationIcon type={n.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">
                      {n.title}
                    </span>
                    <span className="block truncate text-xs text-gray-600">{n.message}</span>
                    <span className="mt-0.5 block text-[11px] text-gray-400">
                      {relativeTime(n.createdAt)}
                    </span>
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

          {/* "Lihat Semua" hanya muncul bila memang ada yang belum tampil di panel */}
          {total > PANEL_LIMIT && (
            <Link
              href="/oms/dashboard/notifikasi"
              onClick={() => setOpen(false)}
              className="block border-t border-gray-100 px-4 py-3 text-center text-sm font-semibold text-brand-primary transition hover:bg-gray-50"
            >
              Lihat Semua ({total})
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
