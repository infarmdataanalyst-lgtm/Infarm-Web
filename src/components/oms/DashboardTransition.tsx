'use client'

// src/components/oms/DashboardTransition.tsx
// Status "sedang memuat" bersama untuk Dashboard OMS saat filter periode diganti.
//
// Kenapa perlu context, bukan useTransition lokal di komponen filter: yang harus diredupkan
// adalah ISI dashboard (kartu + chart) yang dirender di SERVER, sementara transisinya dimulai
// dari komponen filter di client. Satu context membuat keduanya membaca `isPending` yang sama.
//
// Isi dashboard tetap Server Component — ia hanya dilewatkan sebagai `children` ke komponen
// client ini, jadi tak ada tambahan biaya hidrasi untuk kartu/tabel di dalamnya.
//
// TIDAK memakai skeleton: render lama ditahan lalu diredupkan, supaya tak ada lompatan layout
// tiap kali periode diganti.

import { createContext, useContext, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type DashboardTransitionValue = {
  isPending: boolean
  // Navigasi ke URL dashboard baru di dalam transition, sehingga `isPending` menyala sampai
  // data server yang baru siap.
  navigate: (href: string) => void
}

const DashboardTransitionContext = createContext<DashboardTransitionValue | null>(null)

export default function DashboardTransition({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function navigate(href: string) {
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <DashboardTransitionContext.Provider value={{ isPending, navigate }}>
      {children}
    </DashboardTransitionContext.Provider>
  )
}

// Dipakai komponen filter periode. Melempar bila dipakai di luar provider — lebih baik gagal
// keras saat dev daripada tombol filter yang diam-diam tak menavigasi apa pun.
export function useDashboardTransition(): DashboardTransitionValue {
  const value = useContext(DashboardTransitionContext)
  if (!value) {
    throw new Error('useDashboardTransition harus dipakai di dalam <DashboardTransition>')
  }
  return value
}

// Pembungkus isi dashboard: diredupkan selama data periode baru dimuat.
//
// Sengaja TIDAK memakai `pointer-events-none`: bila navigasi tersendat, seluruh dashboard akan
// jadi tak bisa diklik dan itu terasa seperti halaman rusak. Redup + `aria-busy` sudah cukup
// memberi tahu bahwa angka yang tampil masih angka periode sebelumnya.
export function DashboardDim({ children }: { children: ReactNode }) {
  const { isPending } = useDashboardTransition()
  return (
    <div
      aria-busy={isPending}
      className={`transition-opacity duration-200 ${isPending ? 'opacity-50' : 'opacity-100'}`}
    >
      {children}
    </div>
  )
}
