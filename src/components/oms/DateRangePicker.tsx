'use client'

// src/components/oms/DateRangePicker.tsx
// Pemilih RENTANG tanggal untuk filter OMS — satu tombol pemicu, satu kalender.
//
// Menggantikan pola lama "dua kolom input type=date" yang dipakai halaman Pesanan, Produk, dan
// panel custom Dashboard. Masalah pola lama: admin harus memikirkan dua kotak terpisah, tak ada
// gambaran rentangnya, dan urutan terbalik (sampai < dari) baru ketahuan setelah ditekan.
//
// ── Cara pakainya ──
//   Klik ke-1  → tanggal mulai, kalender TETAP terbuka
//   Hover      → pratinjau rentang (warna lebih pudar) tanpa mengubah apa pun
//   Klik ke-2  → tanggal selesai; bila lebih awal dari yang pertama, keduanya DITUKAR otomatis,
//                lalu rentang diterapkan dan kalender menutup
//
// ── Tanpa library ──
// Keputusan pemilik proyek 2026-09-21: dibangun sendiri, bukan memasang react-day-picker + date-fns
// (3 paket, ~1 MB). Alasannya bukan sekadar ukuran — seluruh perhitungan tanggal project ini sudah
// memakai jam dinding WIB sendiri (lihat lib/date-range.ts & lib/dashboard-period.ts), dan
// membungkus library yang punya konsep zona waktunya sendiri justru menambah satu lapis yang harus
// dijaga agar tidak menggeser hari.
//
// ── Yang TIDAK diubah komponen ini ──
// Cara data difilter. Ia hanya memanggil `onApply(dari, sampai)`; halaman pemanggil tetap menulis
// nilai itu ke URL query params seperti sebelumnya.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  DAY_INITIALS,
  RANGE_PRESETS,
  buildMonthGrid,
  formatMonthTitle,
  formatRangeLabel,
  initialMonth,
  isWithin,
  matchingPreset,
  shiftMonth,
  todayWib,
} from '@/lib/date-range'

type Props = {
  from: string // YYYY-MM-DD, '' = belum dipilih
  to: string // YYYY-MM-DD, '' = belum dipilih
  onApply: (from: string, to: string) => void
  // Batas atas yang boleh dipilih (YYYY-MM-DD). Halaman Dashboard mengunci di hari ini karena
  // datanya memang tak pernah ada di masa depan; halaman lain boleh membiarkannya kosong.
  max?: string
  label?: string // teks di atas tombol; kosong = tanpa label
  // Gaya label diserahkan pemanggil: halaman Pesanan memakai label 14px, halaman Produk 12px.
  // Tanpa ini, satu di antara keduanya pasti terlihat asing di halamannya sendiri.
  labelClassName?: string
  placeholder?: string
  showPresets?: boolean
  className?: string
}

export default function DateRangePicker({
  from,
  to,
  onApply,
  max,
  label,
  labelClassName = 'mb-2 block text-sm font-semibold text-gray-700',
  placeholder = 'Semua tanggal',
  showPresets = true,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)

  // Pilihan yang sedang disusun DI DALAM kalender — belum tentu sama dengan props.
  // `draftFrom` terisi tapi `draftTo` kosong = sedang menunggu klik kedua.
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [hovered, setHovered] = useState('')

  const today = useMemo(() => todayWib(), [])
  const [{ year, month }, setMonth] = useState(() => initialMonth(from, today))

  const rootRef = useRef<HTMLDivElement>(null)

  // Props berubah dari luar (mis. admin menekan chip preset di Dashboard, atau membuka URL
  // ber-bookmark) → samakan draft. Disesuaikan SAAT RENDER, bukan di useEffect: menyetel state
  // dari effect membuat satu render tambahan dengan nilai lama, dan ESLint project ini memang
  // melarangnya (react-hooks/set-state-in-effect).
  const [syncedFrom, setSyncedFrom] = useState(from)
  const [syncedTo, setSyncedTo] = useState(to)
  if (syncedFrom !== from || syncedTo !== to) {
    setSyncedFrom(from)
    setSyncedTo(to)
    setDraftFrom(from)
    setDraftTo(to)
    setHovered('')
  }

  // Tutup saat klik di luar & saat Esc. Keduanya hanya dipasang selama kalender terbuka.
  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) batal()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') batal()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Membuka kalender sekaligus melompat ke bulan yang relevan — bulan tanggal mulai bila sudah
  // ada, selain itu bulan berjalan. Dilakukan di penangan klik, BUKAN di effect: menyetel state
  // dari effect berarti satu render tambahan dengan bulan lama sempat terlihat, dan ESLint project
  // ini memang melarangnya (react-hooks/set-state-in-effect).
  function buka() {
    setMonth(initialMonth(draftFrom || from, today))
    setOpen(true)
  }

  // Menutup tanpa menerapkan apa pun: draft dikembalikan ke nilai yang sedang berlaku, supaya
  // pilihan setengah jadi (baru satu klik) tak tertinggal saat kalender dibuka lagi.
  function batal() {
    setDraftFrom(from)
    setDraftTo(to)
    setHovered('')
    setOpen(false)
  }

  function pilihTanggal(date: string) {
    if (max && date > max) return

    // Belum ada tanggal mulai, atau rentang sebelumnya sudah lengkap → mulai rentang baru.
    if (!draftFrom || draftTo) {
      setDraftFrom(date)
      setDraftTo('')
      setHovered('')
      return
    }

    // Klik kedua. Lebih awal dari tanggal mulai → tukar, jangan biarkan rentang terbalik.
    const [awal, akhir] = date < draftFrom ? [date, draftFrom] : [draftFrom, date]
    setDraftFrom(awal)
    setDraftTo(akhir)
    setHovered('')
    onApply(awal, akhir)
    setOpen(false)
  }

  function pakaiPreset(id: string) {
    const preset = RANGE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const r = preset.resolve(today)
    setDraftFrom(r.from)
    setDraftTo(r.to)
    setHovered('')
    onApply(r.from, r.to)
    setOpen(false)
  }

  function reset() {
    setDraftFrom('')
    setDraftTo('')
    setHovered('')
    onApply('', '')
    setOpen(false)
  }

  // Ujung akhir yang dipakai menggambar rentang: tanggal selesai bila sudah dipilih, selain itu
  // tanggal yang sedang di-hover (pratinjau). Inilah yang membuat rentang "mengikuti" kursor.
  const ujung = draftTo || hovered
  const previewMode = !draftTo && Boolean(hovered)
  const [rangeAwal, rangeAkhir] =
    draftFrom && ujung ? (ujung < draftFrom ? [ujung, draftFrom] : [draftFrom, ujung]) : ['', '']

  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month])
  const presetAktif = matchingPreset(from, to, today)
  const teksTombol = formatRangeLabel(from, to)

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && <label className={labelClassName}>{label}</label>}

      {/* === Tombol pemicu === */}
      <button
        type="button"
        onClick={() => (open ? batal() : buka())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
          open ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-300 hover:border-gray-400'
        } bg-white`}
      >
        <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
        <span className={`flex-1 truncate ${teksTombol ? 'text-gray-900' : 'text-gray-400'}`}>
          {teksTombol || placeholder}
        </span>
        {teksTombol && (
          // Hapus cepat tanpa membuka kalender. <span>, bukan <button>, karena tombol di dalam
          // tombol bukan HTML yang sah.
          <span
            role="button"
            tabIndex={0}
            aria-label="Hapus rentang tanggal"
            onClick={(e) => {
              e.stopPropagation()
              reset()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                reset()
              }
            }}
            className="shrink-0 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Latar gelap HANYA di mobile: di sana kalender tampil sebagai lembar bawah, dan tanpa
              latar ini isi halaman di belakangnya masih terlihat bisa disentuh. */}
          <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" aria-hidden />

          <div
            role="dialog"
            aria-label="Pilih rentang tanggal"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[20rem] sm:rounded-2xl"
          >
            {/* Kepala: judul bulan + navigasi. Tombol silang hanya perlu di mobile (di desktop,
                klik di luar sudah cukup dan lebih cepat). */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(year, month, -1))}
                aria-label="Bulan sebelumnya"
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-sm font-bold text-gray-900">{formatMonthTitle(year, month)}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMonth(shiftMonth(year, month, 1))}
                  aria-label="Bulan berikutnya"
                  className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={batal}
                  aria-label="Tutup kalender"
                  className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 sm:hidden"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Penuntun langkah — menjawab "sekarang saya harus klik apa" tanpa perlu ditebak. */}
            <p className="mt-2 text-center text-[11px] text-gray-400">
              {!draftFrom
                ? 'Pilih tanggal mulai'
                : !draftTo
                  ? 'Pilih tanggal selesai'
                  : 'Rentang terpilih'}
            </p>

            {/* === Kisi tanggal === */}
            <div
              className="mt-2 grid grid-cols-7 gap-y-1 text-center"
              onMouseLeave={() => setHovered('')}
            >
              {DAY_INITIALS.map((d, i) => (
                <span key={i} className="py-1 text-[11px] font-semibold text-gray-400">
                  {d}
                </span>
              ))}

              {weeks.flat().map((cell) => {
                const disabled = Boolean(max && cell.date > max)
                const isUjung = cell.date === draftFrom || cell.date === draftTo
                const diDalam =
                  Boolean(rangeAwal) && isWithin(cell.date, rangeAwal, rangeAkhir) && !isUjung

                return (
                  <button
                    key={cell.date}
                    type="button"
                    disabled={disabled}
                    onClick={() => pilihTanggal(cell.date)}
                    onMouseEnter={() => !disabled && setHovered(cell.date)}
                    aria-label={cell.date}
                    aria-current={cell.date === today ? 'date' : undefined}
                    className={[
                      'relative h-9 text-sm transition',
                      // Latar rentang menyambung antar kotak: sudut dibulatkan hanya di ujung.
                      diDalam
                        ? previewMode
                          ? 'bg-emerald-50 text-emerald-900'
                          : 'bg-emerald-100 text-emerald-900'
                        : '',
                      isUjung ? 'rounded-lg bg-emerald-600 font-bold text-white' : '',
                      !isUjung && !diDalam && cell.inMonth ? 'text-gray-700 hover:bg-gray-100' : '',
                      !isUjung && !diDalam && !cell.inMonth ? 'text-gray-300' : '',
                      disabled ? 'cursor-not-allowed text-gray-200 hover:bg-transparent' : '',
                      diDalam && cell.date === rangeAwal ? 'rounded-l-lg' : '',
                      diDalam && cell.date === rangeAkhir ? 'rounded-r-lg' : '',
                    ].join(' ')}
                  >
                    {cell.day}
                    {cell.date === today && !isUjung && (
                      <span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-emerald-500" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* === Pintasan === */}
            {showPresets && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pakaiPreset(p.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      presetAktif === p.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* === Aksi === */}
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={reset}
                className="text-xs font-semibold text-gray-500 transition hover:text-gray-700"
              >
                Reset
              </button>
              {/* "Terapkan" hanya berguna saat baru satu tanggal dipilih: admin yang ingin rentang
                  SEHARI tak perlu mengklik tanggal yang sama dua kali. Rentang lengkap sudah
                  diterapkan otomatis pada klik kedua, jadi tombolnya disembunyikan. */}
              {draftFrom && !draftTo && (
                <button
                  type="button"
                  onClick={() => {
                    onApply(draftFrom, draftFrom)
                    setDraftTo(draftFrom)
                    setOpen(false)
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                >
                  Pakai {formatRangeLabel(draftFrom, draftFrom)}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
