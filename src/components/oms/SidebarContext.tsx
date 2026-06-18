'use client'

// src/components/oms/SidebarContext.tsx
// Context untuk berbagi status buka/tutup sidebar mobile (drawer) antara
// tombol hamburger di OmsHeader dan drawer di Sidebar.

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type SidebarContextValue = {
  // true saat drawer mobile sedang terbuka
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// Provider yang membungkus layout OMS agar header & sidebar berbagi satu state.
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  return (
    <SidebarContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

// Hook untuk mengakses status sidebar mobile dari komponen anak.
export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar harus dipakai di dalam <SidebarProvider>')
  }
  return ctx
}
