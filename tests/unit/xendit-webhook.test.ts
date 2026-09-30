// tests/unit/xendit-webhook.test.ts
// Pemetaan callback Payments API v3 (Payment Session + Payment) → tindakan atas pesanan.
//
// Yang MAHAL kalau salah: menandai Lunas dari nominal yang kurang, atau membatalkan pesanan (dan
// melepas stok) hanya karena SATU percobaan bayar gagal padahal sesinya masih hidup.
// Payload di sini mengikuti referensi API Xendit (apidocs/payment-webhook-notification &
// webhook-notification-…-payment-session, 2026-09-28). Cocokkan ulang dengan callback sungguhan
// pertama di mode test, lalu kunci contohnya di sini.

import { describe, expect, it } from 'vitest'
import {
  isLegacyInvoiceCallback,
  parsePaymentCallback,
  parsePaymentSessionCallback,
  parseXenditCallback,
  resolvePaymentOutcome,
} from '@/lib/xendit/webhook'

const sessionCompleted = {
  event: 'payment_session.completed',
  business_id: '661f87c614802d6c402cd82d',
  created: '2026-09-28T10:00:00Z',
  data: {
    payment_session_id: 'ps-661f87c614802d6c402cd82d',
    reference_id: 'INV-20260928-ABCDEFGH',
    status: 'COMPLETED',
    amount: '79080',
    currency: 'IDR',
    payment_request_id: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
    payment_id: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
  },
}

const paymentCapture = {
  event: 'payment.capture',
  business_id: '603f1c4172bbe840979fd408',
  created: '2026-09-28T10:00:01Z',
  data: {
    payment_id: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
    payment_request_id: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
    reference_id: 'INV-20260928-ABCDEFGH',
    status: 'SUCCEEDED',
    request_amount: '79080',
    currency: 'IDR',
    channel_code: 'DANA',
    captures: [{ capture_id: 'cap-1', capture_amount: '79080', capture_timestamp: '2026-09-28T10:00:00Z' }],
  },
}

describe('parsePaymentSessionCallback', () => {
  it('membaca sesi COMPLETED: invoice dari reference_id, id sesi, nominal string', () => {
    const parsed = parsePaymentSessionCallback(sessionCompleted)
    expect(parsed).toMatchObject({
      invoice: 'INV-20260928-ABCDEFGH',
      event: 'payment_session.completed',
      transactionId: 'ps-661f87c614802d6c402cd82d',
      paymentRequestId: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
      paymentId: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
      rawStatus: 'COMPLETED',
      paidAmount: 79080,
      source: 'payment_session',
    })
  })

  it('menurunkan status dari nama event bila data.status tak ada', () => {
    const parsed = parsePaymentSessionCallback({
      event: 'payment_session.expired',
      data: { payment_session_id: 'ps-x', reference_id: 'INV-1' },
    })
    expect(parsed?.rawStatus).toBe('EXPIRED')
  })

  it('menolak payload tanpa reference_id', () => {
    expect(parsePaymentSessionCallback({ event: 'payment_session.completed', data: { status: 'COMPLETED' } })).toBeNull()
  })

  it('bukan untuk event pembayaran', () => {
    expect(parsePaymentSessionCallback(paymentCapture)).toBeNull()
  })
})

describe('parsePaymentCallback', () => {
  it('membaca payment.capture: channel_code, nominal dari captures', () => {
    const parsed = parsePaymentCallback(paymentCapture)
    expect(parsed).toMatchObject({
      invoice: 'INV-20260928-ABCDEFGH',
      event: 'payment.capture',
      paymentRequestId: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
      paymentId: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
      rawStatus: 'SUCCEEDED',
      paidAmount: 79080,
      paymentMethod: 'DANA',
      source: 'payment',
    })
    // Id sesi tak disebut payload ini → tak dikarang.
    expect(parsed?.transactionId).toBeUndefined()
  })

  it('jatuh ke request_amount bila captures kosong', () => {
    const parsed = parsePaymentCallback({
      ...paymentCapture,
      data: { ...paymentCapture.data, captures: [] },
    })
    expect(parsed?.paidAmount).toBe(79080)
  })

  it('mengenali nama event lama payment.succeeded', () => {
    const parsed = parsePaymentCallback({
      event: 'payment.succeeded',
      data: { reference_id: 'INV-1', payment_id: 'py-1', request_amount: 1000 },
    })
    expect(parsed?.rawStatus).toBe('SUCCEEDED')
  })
})

describe('parseXenditCallback & isLegacyInvoiceCallback', () => {
  it('memilih parser sesi lebih dulu, lalu pembayaran', () => {
    expect(parseXenditCallback(sessionCompleted)?.source).toBe('payment_session')
    expect(parseXenditCallback(paymentCapture)?.source).toBe('payment')
  })

  it('callback Invoice API v2 lama tak dikenali, tapi bisa dideteksi untuk log', () => {
    const legacy = { id: '5f…', external_id: 'INV-1', status: 'PAID', paid_amount: 1000 }
    expect(parseXenditCallback(legacy)).toBeNull()
    expect(isLegacyInvoiceCallback(legacy)).toBe(true)
    expect(isLegacyInvoiceCallback(paymentCapture)).toBe(false)
  })

  it('callback refund bukan urusan parser ini', () => {
    expect(parseXenditCallback({ event: 'refund.succeeded', data: { id: 'rfd-1', reference_id: 'INV-1', status: 'SUCCEEDED' } })).toBeNull()
  })
})

describe('resolvePaymentOutcome', () => {
  const paidSession = parsePaymentSessionCallback(sessionCompleted)!
  const paidPayment = parsePaymentCallback(paymentCapture)!

  it('sesi COMPLETED dengan nominal cukup → Lunas / Diproses', () => {
    expect(resolvePaymentOutcome(paidSession, 79080)).toEqual({ kind: 'paid', paymentStatus: 'Lunas', orderStatus: 'Diproses' })
  })

  it('pembayaran SUCCEEDED dengan nominal cukup → Lunas / Diproses', () => {
    expect(resolvePaymentOutcome(paidPayment, 79080)).toEqual({ kind: 'paid', paymentStatus: 'Lunas', orderStatus: 'Diproses' })
  })

  it('nominal KURANG dari tagihan → underpaid, tak pernah Lunas', () => {
    expect(resolvePaymentOutcome(paidPayment, 80000)).toEqual({ kind: 'underpaid', paidAmount: 79080, expectedAmount: 80000 })
  })

  it('nominal tak terbaca (0) → underpaid (menolak-dengan-aman)', () => {
    expect(resolvePaymentOutcome({ ...paidSession, paidAmount: 0 }, 1000).kind).toBe('underpaid')
  })

  it('sesi EXPIRED / CANCELED → failed (stok dilepas)', () => {
    for (const s of ['EXPIRED', 'CANCELED', 'CANCELLED']) {
      expect(resolvePaymentOutcome({ ...paidSession, rawStatus: s }, 79080).kind).toBe('failed')
    }
  })

  it('percobaan bayar FAILED / EXPIRED → attempt-failed, pesanan TIDAK dibatalkan', () => {
    for (const s of ['FAILED', 'EXPIRED', 'CANCELED', 'VOIDED']) {
      expect(resolvePaymentOutcome({ ...paidPayment, rawStatus: s }, 79080).kind).toBe('attempt-failed')
    }
  })

  it('status menunggu → pending; sesi ACTIVE juga pending', () => {
    expect(resolvePaymentOutcome({ ...paidPayment, rawStatus: 'PENDING' }, 79080).kind).toBe('pending')
    expect(resolvePaymentOutcome({ ...paidPayment, rawStatus: 'AUTHORIZED' }, 79080).kind).toBe('pending')
    expect(resolvePaymentOutcome({ ...paidSession, rawStatus: 'ACTIVE' }, 79080).kind).toBe('pending')
  })

  it('status asing → ignored dengan status mentahnya', () => {
    expect(resolvePaymentOutcome({ ...paidPayment, rawStatus: 'SOMETHING_NEW' }, 79080)).toEqual({ kind: 'ignored', rawStatus: 'SOMETHING_NEW' })
  })
})
