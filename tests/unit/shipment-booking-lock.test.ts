// tests/unit/shipment-booking-lock.test.ts
// Kunci BOOKING: hanya pemicu yang memegang kunci yang boleh memanggil POST /order Mengantar.
//
// Lapis kedua di belakang claimPaidTransition — melindungi setiap pemicu booking, bukan hanya
// webhook (simulate-payment, dan booking ulang dari OMS kelak).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '@/types/order'
import type { ShipmentBookingClaim } from '@/lib/mock-db/orders'

const lock = { result: 'CLAIMED' as ShipmentBookingClaim }
const createShipmentOrder = vi.fn()
const updateShipment = vi.fn(async () => ({}) as Order)

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/mengantar-shipment', () => ({ createShipmentOrder }))
vi.mock('@/lib/mock-db/orders', () => ({
  claimShipmentBooking: async () => lock.result,
  updateShipment,
}))

const order = {
  orderId: 'INV-20261005-UJIKUNCI',
  items: [],
  logistics: { courier: 'Shopee Express', service: 'Reguler' },
} as unknown as Order

describe('bookShipmentForPaidOrder — kunci BOOKING', () => {
  beforeEach(() => {
    createShipmentOrder.mockReset()
    updateShipment.mockClear()
    lock.result = 'CLAIMED'
  })

  it('TAKEN: tak memanggil Mengantar dan tak menulis apa pun', async () => {
    const { bookShipmentForPaidOrder } = await import('@/lib/shipment-booking')
    lock.result = 'TAKEN'

    const hasil = await bookShipmentForPaidOrder(order, '[uji]')

    expect(hasil).toEqual({ status: 'IN_PROGRESS' })
    expect(createShipmentOrder).not.toHaveBeenCalled()
    expect(updateShipment).not.toHaveBeenCalled()
  })

  it('CLAIMED: memanggil Mengantar dan menyimpan resinya', async () => {
    const { bookShipmentForPaidOrder } = await import('@/lib/shipment-booking')
    createShipmentOrder.mockResolvedValue({ ok: true, trackingNumber: 'SPXID1', serviceCode: 'REG' })

    const hasil = await bookShipmentForPaidOrder(order, '[uji]')

    expect(hasil).toMatchObject({ status: 'BOOKED', trackingNumber: 'SPXID1' })
    expect(createShipmentOrder).toHaveBeenCalledTimes(1)
  })

  it('UNAVAILABLE (migration belum jalan): booking tetap dijalankan', async () => {
    const { bookShipmentForPaidOrder } = await import('@/lib/shipment-booking')
    lock.result = 'UNAVAILABLE'
    createShipmentOrder.mockResolvedValue({ ok: true, trackingNumber: 'SPXID2', serviceCode: 'REG' })

    await bookShipmentForPaidOrder(order, '[uji]')

    expect(createShipmentOrder).toHaveBeenCalledTimes(1)
  })

  it('lemparan tak terduga dicatat FAILED, bukan meninggalkan pesanan terkunci', async () => {
    const { bookShipmentForPaidOrder } = await import('@/lib/shipment-booking')
    createShipmentOrder.mockRejectedValue(new TypeError('boom'))

    const hasil = await bookShipmentForPaidOrder(order, '[uji]')

    expect(hasil).toMatchObject({ status: 'FAILED' })
    expect(updateShipment).toHaveBeenCalledWith(
      order.orderId,
      expect.objectContaining({ booked: false }),
    )
  })

  it('pesanan yang sudah ber-resi dilewati sebelum menyentuh kunci', async () => {
    const { bookShipmentForPaidOrder } = await import('@/lib/shipment-booking')

    const hasil = await bookShipmentForPaidOrder({ ...order, trackingNumber: 'JO1' } as Order, '[uji]')

    expect(hasil).toMatchObject({ status: 'ALREADY_BOOKED' })
    expect(createShipmentOrder).not.toHaveBeenCalled()
  })
})
