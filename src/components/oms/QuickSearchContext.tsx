'use client'

// src/components/oms/QuickSearchContext.tsx
// State bersama pencarian cepat OMS: search bar di header MENULIS pencarian, panel mengambang
// di layout MEMBACA hasilnya.
//
// ── Kenapa di layout, bukan di dalam OmsHeader ──
// OmsHeader dirender ulang oleh SETIAP halaman, jadi state di dalamnya hilang begitu admin pindah
// halaman. Provider di layout bertahan lintas halaman: admin bisa membuka Pengembalian Dana sambil
// panel hasil lima nomor pesanan tetap terbuka di pojok layar.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { OmsSearchResponse } from '@/types/oms-search'

type QuickSearchState = {
  open: boolean // panel terlihat (terbuka atau diperkecil)
  minimized: boolean
  query: string // teks yang terakhir dicari
  loading: boolean
  error: string
  data: OmsSearchResponse | null
}

type QuickSearchContextValue = QuickSearchState & {
  search: (text: string) => void
  rerun: () => void
  close: () => void
  toggleMinimized: () => void
}

const INITIAL: QuickSearchState = {
  open: false,
  minimized: false,
  query: '',
  loading: false,
  error: '',
  data: null,
}

const QuickSearchContext = createContext<QuickSearchContextValue | null>(null)

// Provider pencarian cepat — membungkus seluruh halaman OMS di layout dashboard.
export function QuickSearchProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QuickSearchState>(INITIAL)
  // Hanya jawaban permintaan TERAKHIR yang boleh ditampilkan. Admin yang mengetik lalu menekan
  // Enter dua kali cepat bisa menerima jawaban lama SESUDAH jawaban baru; tanpa penanda ini panel
  // menampilkan hasil pencarian yang sudah tidak ia minta.
  const latest = useRef(0)
  const lastQuery = useRef('')

  const search = useCallback((text: string) => {
    const q = text.trim()
    if (!q) return
    lastQuery.current = q
    const id = ++latest.current
    setState((s) => ({ ...s, open: true, minimized: false, query: q, loading: true, error: '' }))

    fetch(`/api/oms/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null)
        if (id !== latest.current) return
        if (!res.ok) {
          const serverMessage =
            typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : ''
          const message =
            serverMessage ||
            (res.status === 401 ? 'Sesi login berakhir. Silakan login ulang.' : 'Pencarian gagal. Coba lagi.')
          setState((s) => ({ ...s, loading: false, error: message, data: null }))
          return
        }
        setState((s) => ({ ...s, loading: false, error: '', data: body as OmsSearchResponse }))
      })
      .catch(() => {
        if (id !== latest.current) return
        setState((s) => ({ ...s, loading: false, error: 'Tidak bisa terhubung ke server.', data: null }))
      })
  }, [])

  // Mengulang pencarian terakhir — dipakai setelah status pesanan diubah dari modal detail.
  const rerun = useCallback(() => {
    if (lastQuery.current) search(lastQuery.current)
  }, [search])

  const close = useCallback(() => {
    latest.current++ // jawaban yang masih di jalan diabaikan
    setState(INITIAL)
  }, [])

  const toggleMinimized = useCallback(() => {
    setState((s) => ({ ...s, minimized: !s.minimized }))
  }, [])

  return (
    <QuickSearchContext.Provider value={{ ...state, search, rerun, close, toggleMinimized }}>
      {children}
    </QuickSearchContext.Provider>
  )
}

// Hook pencarian cepat. null bila dipakai di luar provider (mis. halaman login) — pemanggil
// wajib tetap berfungsi tanpanya.
export function useQuickSearch(): QuickSearchContextValue | null {
  return useContext(QuickSearchContext)
}
