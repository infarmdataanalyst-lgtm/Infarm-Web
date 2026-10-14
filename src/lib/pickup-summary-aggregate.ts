// src/lib/pickup-summary-aggregate.ts
// Hitungan kartu "Penjemputan hari ini" (halaman Pesanan OMS): paket per GUDANG × KURIR untuk satu
// tanggal jemput, paket terlewat jadwal per gudang, dan pesanan tanpa jadwal tercatat. Fungsi MURNI
// — pembacaan database ada di lib/mock-db/pickup-summary.ts — supaya aturannya teruji unit.
//
// ── Definisi (sama dengan alarm lonceng, lib/order-issues.ts) ──
// Baris masukan sudah tersaring: pesanan Diproses yang booking kurirnya BOOKED (resi terbit).
//   - terlewat jadwal   : pickup_date < hari ini (WIB) — kurir belum memindai setelah jadwalnya lewat
//   - tanpa jadwal      : pickup_date kosong — dibooking sebelum kolomnya ada (migration 20261009120000);
//                         jadwalnya ada di Mengantar, hanya tak tercatat di sistem kita
//   - terjadwal tanggal X: pickup_date = X
//
// Semua gudang AKTIF selalu mendapat baris, termasuk yang kosong — admin perlu tahu gudang itu memang
// tak punya paket, bukan gagal dimuat. Gudang nonaktif/terhapus dan pesanan tanpa gudang hanya muncul
// bila punya paket, supaya angkanya tak hilang dari jumlah.

import { courierIdFromLabel } from '@/lib/mengantar-estimate'

export type PickupRow = {
  warehouse_id: string | null
  pickup_date: string | null
  nama_ekspedisi: string | null
}

// Isi satu sel gudang × kurir. `pickupTime` HANYA diisi bila jam jemput gudang ini berbeda dari jam
// kurir di judul kolom. Belum pernah terisi: jadwal per gudang belum ada (keputusan pemilik
// 2026-10-14 — siapkan bentuk datanya dulu), jadi saat ini setiap gudang memakai jam kurir yang sama.
export type PickupCell = { count: number; pickupTime?: string }

export type PickupWarehouseRow = {
  warehouseId: string | null // null = pesanan lama tanpa gudang pemenuh
  name: string
  cells: Record<string, PickupCell> // kode kurir → sel
  total: number // paket terjadwal pada tanggal target
  overdue: number // paket terlewat jadwal (tanggal mana pun sebelum hari ini)
}

export type PickupAggregate = {
  warehouses: PickupWarehouseRow[]
  targetTotal: number
  overdueCount: number
  unscheduledCount: number
  followingCount: number // paket pada tanggal jemput SETELAH target (catatan kaki)
}

export type AggregateInput = {
  rows: PickupRow[]
  activeWarehouses: { id: string; nama: string }[] // urutan tampil
  warehouseNames: Map<string, string> // termasuk gudang nonaktif, untuk baris yang masih punya paket
  courierIds: readonly string[] // kolom kurir, urut
  today: string
  targetDate: string | null
  followingDate: string | null
  warehouseId?: string // diisi = admin satu gudang: hanya baris & angka gudang itu
}

const NO_WAREHOUSE = 'Belum ditentukan'

export function aggregatePickupRows(input: AggregateInput): PickupAggregate {
  const { today, targetDate, followingDate, courierIds, warehouseId } = input
  const rows = warehouseId ? input.rows.filter((r) => r.warehouse_id === warehouseId) : input.rows

  const byWarehouse = new Map<string | null, PickupWarehouseRow>()
  const rowFor = (id: string | null): PickupWarehouseRow => {
    let row = byWarehouse.get(id)
    if (!row) {
      row = {
        warehouseId: id,
        name: id ? (input.warehouseNames.get(id) ?? id) : NO_WAREHOUSE,
        cells: Object.fromEntries(courierIds.map((c) => [c, { count: 0 }])),
        total: 0,
        overdue: 0,
      }
      byWarehouse.set(id, row)
    }
    return row
  }

  // Gudang aktif lebih dulu, sesuai urutannya — baris kosong tetap ada.
  for (const w of input.activeWarehouses) {
    if (!warehouseId || w.id === warehouseId) rowFor(w.id)
  }

  const result: PickupAggregate = {
    warehouses: [],
    targetTotal: 0,
    overdueCount: 0,
    unscheduledCount: 0,
    followingCount: 0,
  }

  for (const r of rows) {
    if (!r.pickup_date) {
      result.unscheduledCount += 1
      continue
    }
    if (r.pickup_date < today) {
      result.overdueCount += 1
      rowFor(r.warehouse_id).overdue += 1
    }
    if (targetDate && r.pickup_date === targetDate) {
      // Kurir kosong/tak dikenal → J&T (courierIdFromLabel): seluruh pesanan sebelum 2026-10-02
      // dibooking J&T. Kurir yang kini tak lagi ditawarkan tetap dihitung di total gudang.
      const courier = courierIdFromLabel(r.nama_ekspedisi)
      const row = rowFor(r.warehouse_id)
      if (row.cells[courier]) row.cells[courier].count += 1
      row.total += 1
      result.targetTotal += 1
    }
    if (followingDate && r.pickup_date === followingDate) result.followingCount += 1
  }

  result.warehouses = [...byWarehouse.values()]
  return result
}
