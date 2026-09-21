'use client'

// src/components/oms/DashboardPeriodFilter.tsx
// Toggle periode Dashboard OMS: preset (Hari ini / 7 / 30 hari / Bulan ini / Tahun ini) +
// custom range dengan date picker native.
//
// Periode disimpan di URL query params (?periode=&dari=&sampai=) supaya bisa di-bookmark,
// di-share, dan tetap sama setelah refresh — pola sama dengan filter di halaman Pesanan & Produk.
//
// Nilai periode aktif diterima sebagai PROPS dari Server Component (bukan useSearchParams),
// sehingga komponen ini tak perlu dibungkus <Suspense> dan halaman tetap satu kali render.
//
// Navigasinya dijalankan lewat <DashboardTransition> (context), BUKAN useTransition lokal —
// status pending-nya juga dipakai meredupkan isi dashboard, jadi harus dibagi.

import { useState } from 'react'
import { Calendar, Loader2 } from 'lucide-react'
import { DEFAULT_PERIOD, PERIOD_OPTIONS, type PeriodPreset } from '@/lib/dashboard-period'
import { useDashboardTransition } from '@/components/oms/DashboardTransition'
import DateRangePicker from '@/components/oms/DateRangePicker'

type Props = {
  preset: PeriodPreset
  fromDate: string // YYYY-MM-DD (WIB) — batas bawah periode aktif
  toDate: string // YYYY-MM-DD (WIB) — batas atas periode aktif
  today: string // YYYY-MM-DD (WIB) — batas `max` input tanggal; dihitung di server agar konsisten
}

export default function DashboardPeriodFilter({ preset, fromDate, toDate, today }: Props) {
  // Navigasi RSC menahan render lama sampai data baru siap; `isPending` dipakai di sini untuk
  // spinner DAN oleh <DashboardDim> untuk meredupkan kartu/chart. Tanpa indikator, klik preset
  // terasa tidak merespons pada koneksi lambat.
  const { isPending, navigate: navigateTo } = useDashboardTransition()

  // Panel custom terbuka bila periode aktif memang custom, atau saat admin menekan "Custom".
  const [customOpen, setCustomOpen] = useState(preset === 'custom')

  function navigate(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString()
    navigateTo(`/oms/dashboard${query ? `?${query}` : ''}`)
  }

  // Preset non-custom membuang dari/sampai agar URL tidak menyimpan rentang yang tak lagi dipakai.
  function selectPreset(value: PeriodPreset) {
    if (value === 'custom') {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    navigate({ periode: value })
  }

  // Rentang custom diterapkan SETELAH dua klik di kalender — tak ada lagi keadaan "setengah jadi"
  // yang dulu perlu ditahan tombol Terapkan: DateRangePicker baru memanggil balik saat rentangnya
  // sudah lengkap. Rentang kosong (tombol Reset) mengembalikan dashboard ke periode bawaan.
  function applyRange(from: string, to: string) {
    if (!from || !to) {
      setCustomOpen(false)
      navigate({ periode: DEFAULT_PERIOD })
      return
    }
    navigate({ periode: 'custom', dari: from, sampai: to })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* === Baris preset === */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-white p-1.5">
        {PERIOD_OPTIONS.map((option) => {
          const active =
            option.value === 'custom' ? preset === 'custom' || customOpen : preset === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => selectPreset(option.value)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-brand-primary text-white'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {option.value === 'custom' && <Calendar className="h-3.5 w-3.5" />}
              {option.label}
            </button>
          )
        })}
        {isPending && (
          <span className="ml-1 inline-flex items-center gap-1.5 px-2 text-xs font-medium text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Memuat…
          </span>
        )}
      </div>

      {/* === Panel custom range ===
          Dulu dua kolom input tanggal + tombol Terapkan. Sekarang satu kalender: rentang
          diterapkan begitu klik kedua jatuh, jadi tak ada lagi rentang setengah jadi yang perlu
          divalidasi sendiri ("tanggal awal tidak boleh melewati tanggal akhir" — kalender menukar
          keduanya otomatis). Preset di dalam kalender sengaja DIMATIKAN: chip di atas sudah
          menyediakannya, dan dua tempat memilih hal yang sama hanya membingungkan. */}
      {customOpen && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <DateRangePicker
            from={preset === 'custom' ? fromDate : ''}
            to={preset === 'custom' ? toDate : ''}
            onApply={applyRange}
            max={today}
            showPresets={false}
            placeholder="Pilih rentang tanggal"
            className="sm:max-w-xs"
          />
        </div>
      )}
    </div>
  )
}
