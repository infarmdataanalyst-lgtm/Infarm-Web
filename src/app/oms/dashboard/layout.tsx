// src/app/oms/dashboard/layout.tsx
// Layout bersama untuk seluruh halaman OMS (/oms/dashboard/*).
// Menyediakan Sidebar fixed di kiri; konten halaman digeser ke kanan (md:ml-64).

import type { ReactNode } from 'react'
import Sidebar from '@/components/oms/Sidebar'
import { SidebarProvider } from '@/components/oms/SidebarContext'
import { QuickSearchProvider } from '@/components/oms/QuickSearchContext'
import QuickSearchPanel from '@/components/oms/QuickSearchPanel'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    // Provider membungkus header & sidebar agar berbagi state drawer mobile
    <SidebarProvider>
      {/* Pencarian cepat: search bar di header menulis, panel mengambang membaca. Diletakkan di
          layout supaya panel tetap terbuka saat admin pindah halaman. */}
      <QuickSearchProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar />
          {/* Konten utama digeser sejauh lebar sidebar (64) pada layar desktop */}
          <div className="md:ml-64">{children}</div>
        </div>
        <QuickSearchPanel />
      </QuickSearchProvider>
    </SidebarProvider>
  )
}
