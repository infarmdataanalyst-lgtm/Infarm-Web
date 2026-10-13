// tests/unit/oms-pii.test.ts
// Sensor data pembeli untuk akun OMS berperan 'staff'. Yang mahal kalau salah: nomor HP, email,
// alamat, atau rekening refund pembeli sampai utuh ke browser staff — atau sebaliknya, admin ikut
// tersensor sehingga tak bisa menghubungi pembeli.

import { describe, expect, it } from 'vitest'
import { maskEmail } from '@/lib/mask'
import {
  maskNameForRole,
  maskOrderForRole,
  maskOrdersForRole,
  maskRefundItemsForRole,
  shouldMaskBuyerPii,
} from '@/lib/oms-pii'
import type { Order, RefundWorkItem } from '@/types/order'

const order: Order = {
  orderId: 'INV-20261013-ABCD1234',
  customerName: 'Budi Santoso',
  customerPhone: '081234567890',
  customerEmail: 'budi.santoso@gmail.com',
  date: '2026-10-13T03:00:00.000Z',
  items: [],
  totalAmount: 50000,
  paymentStatus: 'Lunas',
  status: 'Diproses',
  refundNote: 'BCA 1234567890 a.n. Budi',
  address: {
    shippingAddress: 'Jl. Merpati No. 12 RT 03',
    provinsi: 'Jawa Timur',
    kota: 'Surabaya',
    kecamatan: 'Sukolilo',
    kelurahan: 'Keputih',
    kodepos: '60111',
    destinationId: 'abc',
  },
}

describe('shouldMaskBuyerPii', () => {
  it('admin melihat utuh, staff tersensor', () => {
    expect(shouldMaskBuyerPii('admin')).toBe(false)
    expect(shouldMaskBuyerPii('staff')).toBe(true)
  })
})

describe('maskOrderForRole', () => {
  it('admin → objek yang sama persis, tanpa perubahan', () => {
    expect(maskOrderForRole(order, 'admin')).toBe(order)
  })

  it('staff → nama, HP, email, jalan tersensor; catatan refund dibuang', () => {
    const m = maskOrderForRole(order, 'staff')
    expect(m.customerName).toBe('B**i S*****o')
    expect(m.customerPhone).toBe('0812****7890')
    expect(m.customerEmail).toBe('b***@gmail.com')
    expect(m.address?.shippingAddress).not.toContain('Merpati')
    expect('refundNote' in m).toBe(false)
  })

  it('staff → wilayah alamat & data pesanan lain tetap utuh', () => {
    const m = maskOrderForRole(order, 'staff')
    expect(m.orderId).toBe(order.orderId)
    expect(m.totalAmount).toBe(order.totalAmount)
    expect(m.address?.kota).toBe('Surabaya')
    expect(m.address?.kodepos).toBe('60111')
  })

  it('staff → tidak mengubah objek asli', () => {
    maskOrderForRole(order, 'staff')
    expect(order.customerName).toBe('Budi Santoso')
    expect(order.refundNote).toBe('BCA 1234567890 a.n. Budi')
  })

  it('field opsional yang kosong tetap kosong', () => {
    const bare: Order = { ...order, customerPhone: undefined, customerEmail: undefined, address: undefined }
    const m = maskOrderForRole(bare, 'staff')
    expect(m.customerPhone).toBeUndefined()
    expect(m.customerEmail).toBeUndefined()
    expect(m.address).toBeUndefined()
  })
})

describe('maskOrdersForRole & maskRefundItemsForRole', () => {
  it('daftar pesanan staff tersensor semua barisnya', () => {
    const list = maskOrdersForRole([order, { ...order, customerName: 'Siti' }], 'staff')
    expect(list.map((o) => o.customerName)).toEqual(['B**i S*****o', 'S**i'])
  })

  it('daftar kerja refund: kontak pembeli tersensor untuk staff, utuh untuk admin', () => {
    const item: RefundWorkItem = {
      orderId: order.orderId,
      customerName: 'Budi Santoso',
      customerPhone: '081234567890',
      customerEmail: 'budi@gmail.com',
      date: order.date,
      totalAmount: 50000,
    }
    const [staff] = maskRefundItemsForRole([item], 'staff')
    expect(staff.customerPhone).toBe('0812****7890')
    expect(staff.customerEmail).toBe('b***@gmail.com')
    expect(maskRefundItemsForRole([item], 'admin')[0]).toBe(item)
  })

  it('maskNameForRole', () => {
    expect(maskNameForRole('Budi Santoso', 'staff')).toBe('B**i S*****o')
    expect(maskNameForRole('Budi Santoso', 'admin')).toBe('Budi Santoso')
  })
})

describe('maskEmail', () => {
  it('menyisakan huruf pertama dan domain', () => {
    expect(maskEmail('budi.santoso@gmail.com')).toBe('b***@gmail.com')
    expect(maskEmail(' a@x.id ')).toBe('a***@x.id')
  })

  it('teks tanpa @ tetap tersamar, tidak bocor utuh', () => {
    expect(maskEmail('bukanemail')).not.toBe('bukanemail')
  })
})
