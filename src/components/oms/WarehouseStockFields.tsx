'use client'

// src/components/oms/WarehouseStockFields.tsx
// Input stok produk yang menyesuaikan mode pergudangan. Dipakai form tambah produk DAN modal edit
// agar keduanya tak pernah berbeda perilaku.
//
// Mode single : SATU input, persis seperti sebelum fitur gudang ada. Nilainya disimpan ke gudang
//               default di server — admin tak perlu tahu soal gudang sama sekali.
// Mode multi  : satu input per gudang AKTIF + baris total. Tanpa ini, di mode multi admin mengisi
//               satu angka yang diam-diam hanya masuk ke gudang default (sumber salah input).
//
// Komponen ini TIDAK menyimpan apa pun sendiri; ia hanya melaporkan peta {warehouseId: stok} ke
// parent, yang mengirimkannya bersama payload produk.

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import type { Warehouse, WarehouseMode } from '@/types/warehouse'

// Peta stok per gudang. '' = input dikosongkan (dianggap 0 saat disimpan).
export type StockByWarehouse = Record<string, number | ''>

// Menjumlahkan peta stok → dipakai parent untuk mengisi field `stock` (total) pada payload
// dan untuk validasi total memakai aturan stok yang sudah ada.
export function sumStock(map: StockByWarehouse): number {
  return Object.values(map).reduce<number>((total, v) => total + (v === '' ? 0 : v), 0)
}

export default function WarehouseStockFields({
  productId,
  singleValue,
  onSingleChange,
  value,
  onChange,
  onModeResolved,
  inputClassName,
  invalid,
}: {
  productId?: string // diisi saat edit → memuat stok per gudang yang tersimpan
  singleValue: number | '' // nilai input tunggal (mode single)
  onSingleChange: (value: number | '') => void
  value: StockByWarehouse // nilai per gudang (mode multi)
  onChange: (next: StockByWarehouse) => void
  onModeResolved?: (mode: WarehouseMode) => void
  inputClassName: string // kelas input milik form pemanggil (biar gaya konsisten)
  invalid?: boolean
}) {
  const [mode, setMode] = useState<WarehouseMode | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loadError, setLoadError] = useState('')

  // Muat daftar gudang + mode. Selama belum termuat, input tunggal tetap ditampilkan supaya form
  // tidak pernah kosong/mengunci admin bila endpoint gudang bermasalah.
  useEffect(() => {
    let active = true
    fetch('/api/warehouses/list')
      .then((res) => res.json())
      .then((data: { mode?: WarehouseMode; warehouses?: Warehouse[]; error?: string }) => {
        if (!active) return
        if (data.error) {
          setLoadError(data.error)
          setMode('single')
          return
        }
        const resolved = data.mode ?? 'single'
        setMode(resolved)
        setWarehouses((data.warehouses ?? []).filter((w) => w.isActive))
        onModeResolved?.(resolved)
      })
      .catch(() => {
        if (!active) return
        setLoadError('Gagal memuat daftar gudang — memakai input stok tunggal.')
        setMode('single')
      })
    return () => {
      active = false
    }
    // onModeResolved sengaja tak masuk deps: parent boleh melewatkan closure baru tiap render,
    // dan pemuatan ini hanya perlu sekali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Isi nilai awal per gudang saat edit produk (mode multi saja).
  useEffect(() => {
    if (mode !== 'multi' || !productId) return
    let active = true
    fetch(`/api/warehouses/stock?productId=${encodeURIComponent(productId)}`)
      .then((res) => res.json())
      .then((data: { rows?: { warehouseId: string; variantId?: string; stok: number }[] }) => {
        if (!active) return
        const next: StockByWarehouse = {}
        // Hanya baris produk (variant_id null). Stok per varian dikelola di modal varian tersendiri.
        for (const row of data.rows ?? []) {
          if (!row.variantId) next[row.warehouseId] = row.stok
        }
        onChange(next)
      })
      .catch(() => {
        // Gagal memuat → input tetap kosong; admin bisa mengisi ulang
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, productId])

  function handleChange(warehouseId: string, raw: string) {
    const digits = raw.replace(/\D/g, '')
    onChange({ ...value, [warehouseId]: digits === '' ? '' : Number(digits) })
  }

  // Mode single (atau belum termuat) → tampilan lama, satu input.
  if (mode !== 'multi' || warehouses.length === 0) {
    return (
      <>
        <input
          type="text"
          inputMode="numeric"
          value={singleValue}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '')
            onSingleChange(digits === '' ? '' : Number(digits))
          }}
          placeholder="0"
          className={inputClassName}
          aria-invalid={invalid}
        />
        {loadError && <p className="mt-1 text-xs text-orange-600">{loadError}</p>}
      </>
    )
  }

  // Mode multi → satu input per gudang aktif + total
  const total = sumStock(value)
  return (
    <div className="space-y-2">
      <div className="flex gap-2 rounded-lg bg-orange-50 px-2.5 py-2 text-xs leading-relaxed text-orange-700">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <p>
          Mode multi-gudang aktif. Isi stok untuk setiap gudang — pembeli melihat totalnya, dan
          pesanan dipenuhi gudang terdekat yang stoknya cukup.
        </p>
      </div>

      {warehouses.map((w) => (
        <div key={w.id} className="flex items-center gap-2">
          <label
            htmlFor={`wh-stock-${w.id}`}
            className="min-w-0 flex-1 truncate text-xs text-gray-600"
            title={w.nama}
          >
            {w.nama}
            {w.isDefault && <span className="ml-1 text-[11px] text-brand-primary">(default)</span>}
          </label>
          <input
            id={`wh-stock-${w.id}`}
            type="text"
            inputMode="numeric"
            value={value[w.id] ?? ''}
            onChange={(e) => handleChange(w.id, e.target.value)}
            placeholder="0"
            className={`${inputClassName} w-24 shrink-0`}
          />
        </div>
      ))}

      <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
        <span className="font-medium text-gray-600">Total stok</span>
        <span className="font-bold text-gray-900">{total.toLocaleString('id-ID')}</span>
      </div>
    </div>
  )
}
