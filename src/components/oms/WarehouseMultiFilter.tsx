'use client'

// src/components/oms/WarehouseMultiFilter.tsx
// Filter "Gudang" MULTI-SELECT untuk halaman Pesanan OMS: tombol pemicu + panel berisi checkbox.
//
// KENAPA BUKAN <select>: elemen select native tak bisa memuat checkbox, dan highlight opsinya
// digambar oleh sistem operasi (biru) sehingga TIDAK bisa diwarnai lewat CSS halaman. Persoalan
// yang sama sudah pernah muncul di sort katalog storefront (lihat catatan Headless UI di CLAUDE.md).
//
// KENAPA POPOVER TANGAN SENDIRI, bukan Headless UI Listbox: panel ini butuh footer aksi
// ("Reset" + "Terapkan") di dalam dropdown. Listbox menganggap seluruh isi panelnya sebagai daftar
// opsi, jadi menyisipkan tombol di sana berlawanan dengan modelnya. Pola tutup via pointerdown +
// Escape di bawah SAMA dengan NotificationBell, ProfileIconLink, dan MiniCart.
//
// MODEL DRAFT: mencentang opsi TIDAK langsung menyaring tabel — perubahan ditahan sebagai draft
// sampai "Terapkan" ditekan, supaya admin bisa memilih beberapa gudang sekaligus tanpa memicu
// request per klik. Panel juga sengaja tidak tertutup saat opsi dicentang.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export default function WarehouseMultiFilter({
  warehouses,
  value,
  onChange,
  noneValue,
  noneLabel,
}: {
  // Gudang AKTIF saja (gudang nonaktif tak menerima pesanan baru)
  warehouses: { id: string; nama: string }[]
  // Nilai terpasang. Array KOSONG = "Semua gudang" (tak ada filter) — tidak ada state ketiga.
  value: string[]
  // Dipanggil hanya saat "Terapkan" ditekan, bukan saat opsi dicentang.
  onChange: (next: string[]) => void
  // Nilai & label khusus pesanan lama yang warehouse_id-nya NULL
  noneValue: string
  noneLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(value)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Tutup saat klik di luar / tekan Escape. Menutup panel MEMBATALKAN draft (nilai terpasang tak
  // berubah) — sengaja, supaya tak ada filter yang diam-diam berlaku tanpa "Terapkan".
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

  // Draft diselaraskan ke nilai terpasang SAAT PANEL DIBUKA (bukan lewat useEffect: lint
  // `react-hooks/set-state-in-effect` melarang setState sinkron di dalam efek, dan ini memang
  // reaksi terhadap aksi pengguna).
  function togglePanel() {
    if (!open) setDraft(value)
    setOpen((v) => !v)
  }

  // Mencentang/melepas satu gudang. Melepas centang terakhir menghasilkan array kosong = otomatis
  // kembali ke "Semua gudang" — tidak perlu penanganan khusus, karena kosong SUDAH berarti
  // "tanpa filter". Itu juga yang mencegah adanya state kosong tanpa filter aktif.
  function toggleOne(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  // "Semua gudang" = shortcut mengosongkan pilihan spesifik.
  function selectAll() {
    setDraft([])
  }

  function apply() {
    onChange(draft)
    setOpen(false)
  }

  const allChecked = draft.length === 0

  // Label tombol saat panel tertutup
  const options = [...warehouses.map((w) => ({ id: w.id, nama: w.nama })), { id: noneValue, nama: noneLabel }]
  let triggerLabel = 'Semua gudang'
  if (value.length === 1) {
    triggerLabel = options.find((o) => o.id === value[0])?.nama ?? '1 Gudang dipilih'
  } else if (value.length > 1) {
    triggerLabel = `${value.length} Gudang dipilih`
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        aria-haspopup="true"
        aria-expanded={open}
        // Border & ring hijau brand (#00843b lewat token brand-primary), bukan biru bawaan.
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm text-gray-900 transition ${
          open
            ? 'border-brand-primary ring-2 ring-brand-primary/20'
            : 'border-gray-300 hover:border-brand-primary/60'
        }`}
      >
        <span className={`truncate ${value.length > 0 ? 'font-semibold text-brand-primary' : ''}`}>
          {triggerLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-none text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-brand-light bg-white shadow-lg">
          <ul className="max-h-64 overflow-y-auto py-1" role="group" aria-label="Pilihan gudang">
            <OptionRow label="Semua gudang" checked={allChecked} onToggle={selectAll} />
            {warehouses.map((w) => (
              <OptionRow
                key={w.id}
                label={w.nama}
                checked={draft.includes(w.id)}
                onToggle={() => toggleOne(w.id)}
              />
            ))}
            {/* Pesanan sebelum fitur multi-gudang tetap bisa ditemukan & diaudit */}
            <OptionRow
              label={noneLabel}
              checked={draft.includes(noneValue)}
              onToggle={() => toggleOne(noneValue)}
            />
          </ul>

          {/* Footer aksi. "Reset" mengosongkan DRAFT (bukan langsung menyaring) supaya modelnya
              tetap satu: apa pun yang diubah di panel baru berlaku setelah "Terapkan". */}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={allChecked}
              className="text-xs font-semibold text-gray-500 transition hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-brand-primary px-4 py-1.5 text-xs font-bold text-white transition hover:brightness-90 active:scale-[0.98]"
            >
              Terapkan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Satu baris opsi: checkbox hijau brand + label. Checkbox memakai pola yang sama dengan keranjang
// & katalog storefront (kotak putih ber-border → hijau brand + centang PUTIH saat dicentang),
// bukan checkbox bawaan browser yang biru.
function OptionRow({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-brand-surface ${
          checked ? 'font-semibold text-brand-primary' : 'text-gray-700'
        }`}
      >
        <span
          className={`flex h-4 w-4 flex-none items-center justify-center rounded border transition ${
            checked ? 'border-brand-primary bg-brand-primary' : 'border-zinc-300 bg-white'
          }`}
        >
          {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  )
}
