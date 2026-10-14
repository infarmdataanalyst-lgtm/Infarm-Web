// tests/unit/pickup-summary-aggregate.test.ts
// Hitungan kartu "Penjemputan hari ini". Yang mahal kalau salah: paket terlewat tak terlihat (kurir
// tak datang dan tak ada yang tahu), paket terhitung di gudang/kurir yang salah, atau gudang kosong
// lenyap dari kartu sehingga admin mengira datanya gagal dimuat.

import { describe, expect, it } from 'vitest'
import { aggregatePickupRows, type AggregateInput, type PickupRow } from '@/lib/pickup-summary-aggregate'

const SBY = 'sby'
const JKT = 'jkt'
const SMG = 'smg'
const TODAY = '2026-10-14'
const NEXT = '2026-10-15'

function input(rows: PickupRow[], extra: Partial<AggregateInput> = {}): AggregateInput {
  return {
    rows,
    activeWarehouses: [
      { id: SBY, nama: 'Gudang Utama Surabaya' },
      { id: JKT, nama: 'Gudang Jakarta' },
      { id: SMG, nama: 'Gudang Semarang' },
    ],
    warehouseNames: new Map([
      [SBY, 'Gudang Utama Surabaya'],
      [JKT, 'Gudang Jakarta'],
      [SMG, 'Gudang Semarang'],
      ['lama', 'Gudang Lama (nonaktif)'],
    ]),
    courierIds: ['JT', 'spx'],
    today: TODAY,
    targetDate: TODAY,
    followingDate: NEXT,
    ...extra,
  }
}

const r = (warehouse_id: string | null, pickup_date: string | null, nama_ekspedisi: string | null = 'J&T'): PickupRow => ({
  warehouse_id,
  pickup_date,
  nama_ekspedisi,
})

describe('aggregatePickupRows', () => {
  const rows = [
    r(SBY, TODAY, 'J&T'),
    r(SBY, TODAY, 'J&T'),
    r(SBY, TODAY, 'Shopee Express'),
    r(JKT, TODAY, 'Shopee Express'),
    r(SBY, '2026-10-12'), // terlewat
    r(JKT, '2026-10-13'), // terlewat
    r(JKT, '2026-10-10'), // terlewat
    r(SBY, NEXT), // menunggu jadwal berikutnya
    r(SBY, null), // tanpa jadwal
    r(null, null), // tanpa jadwal, tanpa gudang
  ]

  it('menghitung gudang × kurir untuk tanggal target', () => {
    const a = aggregatePickupRows(input(rows))
    const sby = a.warehouses.find((w) => w.warehouseId === SBY)!
    expect(sby.cells).toEqual({ JT: { count: 2 }, spx: { count: 1 } })
    expect(sby.total).toBe(3)
    expect(a.warehouses.find((w) => w.warehouseId === JKT)!.cells.spx.count).toBe(1)
    expect(a.targetTotal).toBe(4)
  })

  it('terlewat, tanpa jadwal, dan jadwal berikutnya', () => {
    const a = aggregatePickupRows(input(rows))
    expect(a.overdueCount).toBe(3)
    expect(a.warehouses.map((w) => [w.warehouseId, w.overdue])).toEqual([
      [SBY, 1],
      [JKT, 2],
      [SMG, 0],
    ])
    expect(a.unscheduledCount).toBe(2)
    expect(a.followingCount).toBe(1)
  })

  it('gudang aktif yang kosong tetap punya baris, urutannya dipertahankan', () => {
    const a = aggregatePickupRows(input([]))
    expect(a.warehouses.map((w) => w.name)).toEqual(['Gudang Utama Surabaya', 'Gudang Jakarta', 'Gudang Semarang'])
    expect(a.warehouses.every((w) => w.total === 0 && w.cells.JT.count === 0)).toBe(true)
  })

  it('gudang nonaktif / pesanan tanpa gudang muncul hanya bila punya paket', () => {
    const a = aggregatePickupRows(input([r('lama', TODAY), r(null, '2026-10-01')]))
    expect(a.warehouses.map((w) => w.name)).toEqual([
      'Gudang Utama Surabaya',
      'Gudang Jakarta',
      'Gudang Semarang',
      'Gudang Lama (nonaktif)',
      'Belum ditentukan',
    ])
    expect(a.warehouses.at(-1)!.overdue).toBe(1)
  })

  it('kurir kosong dihitung sebagai J&T (semua pesanan sebelum 2 Okt dibooking J&T)', () => {
    const a = aggregatePickupRows(input([r(SBY, TODAY, null), r(SBY, TODAY, '')]))
    expect(a.warehouses[0].cells.JT.count).toBe(2)
  })

  it('hari Minggu/libur: tanggal target = jadwal berikutnya, tanpa catatan kaki', () => {
    const a = aggregatePickupRows(input(rows, { targetDate: NEXT, followingDate: null }))
    expect(a.targetTotal).toBe(1)
    expect(a.followingCount).toBe(0)
    expect(a.overdueCount).toBe(3)
  })

  it('satu gudang (admin per gudang): hanya baris & angka gudang itu', () => {
    const a = aggregatePickupRows(input(rows, { warehouseId: JKT }))
    expect(a.warehouses.map((w) => w.warehouseId)).toEqual([JKT])
    expect(a.overdueCount).toBe(2)
    expect(a.unscheduledCount).toBe(0)
    expect(a.targetTotal).toBe(1)
  })
})
