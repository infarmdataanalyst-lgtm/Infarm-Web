// src/app/oms/dashboard/layout.tsx
// Layout bersama untuk seluruh halaman OMS (/oms/dashboard/*).
// Menyediakan Sidebar fixed di kiri; konten halaman digeser ke kanan (md:ml-64).

import type { ReactNode } from 'react'
import Sidebar from '@/components/oms/Sidebar'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      {/* Konten utama digeser sejauh lebar sidebar (64) pada layar desktop */}
      <div className="md:ml-64">{children}</div>
    </div>
  )
}
