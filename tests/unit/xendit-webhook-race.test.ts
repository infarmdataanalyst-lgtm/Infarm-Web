// tests/unit/xendit-webhook-race.test.ts
// Dua callback Xendit untuk SATU pembayaran yang tiba serentak hanya boleh membooking kurir sekali.
//
// Terukur 2026-10-05 (INV-20261005-YV2GX0NS): `payment_session.completed` dan `payment.capture`
// tiba 0,17 detik berselisih, keduanya membaca "belum Lunas", dan keduanya memanggil POST /order.
//
// Database di sini diganti tiruan dalam memori. Yang diuji adalah KONTRAK yang dipakai webhook:
// claimPaidTransition menilai syaratnya saat menulis (atomik — di tiruan ini, bagian sinkron setelah
// `await`), sedangkan getOrderByOrderId bisa mengembalikan baris yang sudah basi.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '@/types/order'

const INVOICE = 'INV-20261005-YV2GX0NS'
const TOTAL = 75120

const db = {
  paymentStatus: 'Menunggu' as Order['paymentStatus'],
  status: 'Menunggu Pembayaran' as Order['status'],
  paymentMethod: undefined as string | undefined,
}

// Satu putaran event loop: memberi callback kembar kesempatan menyela di antara baca dan tulis.
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const snapshot = (): Order =>
  ({
    orderId: INVOICE,
    totalAmount: TOTAL,
    paymentStatus: db.paymentStatus,
    status: db.status,
    paymentMethod: db.paymentMethod,
    items: [],
  }) as unknown as Order

const booking = vi.fn(async () => ({ status: 'FAILED', reason: 'courier-rejected', detail: '-' }))
const purchase = vi.fn(async () => undefined)

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/shipment-booking', () => ({ bookShipmentForPaidOrder: booking }))
vi.mock('@/lib/analytics-server', () => ({ sendPurchaseEvent: purchase }))
vi.mock('@/lib/mock-db/cached-reads', () => ({ getCachedProducts: async () => [] }))
vi.mock('@/lib/order-expiry', () => ({ expireOrder: vi.fn(), revalidateAfterExpiry: vi.fn() }))
vi.mock('@/lib/mock-db/orders', () => ({
  getOrderByOrderId: async () => {
    const baris = snapshot()
    await yieldTurn()
    return baris
  },
  claimPaidTransition: async (_invoice: string, opts?: { paymentMethod?: string }) => {
    await yieldTurn()
    if (db.paymentStatus === 'Lunas' || db.status === 'Dibatalkan') return { status: 'NOT_CLAIMED' }
    db.paymentStatus = 'Lunas'
    db.status = 'Diproses'
    if (opts?.paymentMethod) db.paymentMethod = opts.paymentMethod
    return { status: 'CLAIMED', order: snapshot() }
  },
  fillPaymentMethodIfEmpty: async (_invoice: string, method: string) => {
    if (db.paymentMethod) return false
    db.paymentMethod = method
    return true
  },
  settleRefundByReference: vi.fn(),
}))

const sessionCompleted = {
  event: 'payment_session.completed',
  business_id: 'biz',
  created: '2026-10-05T06:34:16Z',
  data: {
    payment_session_id: 'ps-1',
    reference_id: INVOICE,
    status: 'COMPLETED',
    amount: String(TOTAL),
    currency: 'IDR',
    payment_request_id: 'pr-1',
    payment_id: 'py-1',
  },
}

const paymentCapture = {
  event: 'payment.capture',
  business_id: 'biz',
  created: '2026-10-05T06:34:16Z',
  data: {
    payment_id: 'py-1',
    payment_request_id: 'pr-1',
    reference_id: INVOICE,
    status: 'SUCCEEDED',
    request_amount: String(TOTAL),
    currency: 'IDR',
    channel_code: 'MANDIRI_DIRECT_DEBIT',
    captures: [{ capture_id: 'cap-1', capture_amount: String(TOTAL), capture_timestamp: '2026-10-05T06:34:16Z' }],
  },
}

const callback = (body: unknown) =>
  new Request('http://localhost/api/webhooks/xendit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-callback-token': 'token-uji' },
    body: JSON.stringify(body),
  })

describe('webhook Xendit — dua callback serentak untuk satu pembayaran', () => {
  beforeEach(() => {
    process.env.XENDIT_CALLBACK_TOKEN = 'token-uji'
    db.paymentStatus = 'Menunggu'
    db.status = 'Menunggu Pembayaran'
    db.paymentMethod = undefined
    booking.mockClear()
    purchase.mockClear()
  })

  it('hanya satu yang membooking kurir dan mengirim purchase GA4', async () => {
    const { POST } = await import('@/app/api/webhooks/xendit/route')

    const [a, b] = await Promise.all([POST(callback(sessionCompleted)), POST(callback(paymentCapture))])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(booking).toHaveBeenCalledTimes(1)
    expect(purchase).toHaveBeenCalledTimes(1)
    expect(db.paymentStatus).toBe('Lunas')
  })

  it('callback yang kalah tetap melengkapi metode bayar yang hanya dibawanya', async () => {
    const { POST } = await import('@/app/api/webhooks/xendit/route')

    // Sesi menang (tanpa channel_code); capture kalah tapi membawa metodenya.
    await Promise.all([POST(callback(sessionCompleted)), POST(callback(paymentCapture))])

    expect(db.paymentMethod).toBe('MANDIRI_DIRECT_DEBIT')
  })

  it('callback ulangan yang tiba belakangan tak membooking lagi', async () => {
    const { POST } = await import('@/app/api/webhooks/xendit/route')

    await POST(callback(sessionCompleted))
    await POST(callback(paymentCapture))
    await POST(callback(sessionCompleted))

    expect(booking).toHaveBeenCalledTimes(1)
  })
})
