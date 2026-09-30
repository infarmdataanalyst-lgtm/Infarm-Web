// tests/unit/xendit-refund-callback.test.ts
// Pengurai callback refund Payments API v3. Bentuk payload dari referensi Xendit
// (apidocs/refund-webhook-notification, 2026-09-28) — cocokkan dengan callback sungguhan pertama.

import { describe, expect, it } from 'vitest'
import { callbackEventName, isRefundEvent, parseRefundCallback } from '@/lib/xendit/refund-callback'

const succeeded = {
  event: 'refund.succeeded',
  business_id: '6094fa76c2fd53701b8e079c',
  created: '2026-09-28T10:05:00Z',
  data: {
    id: 'rfd-6f4a377d-a201-437f-9119-f8b00cbbe857',
    payment_request_id: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
    payment_id: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
    reference_id: 'INV-20260928-ABCDEFGH',
    amount: 79080,
    currency: 'IDR',
    status: 'SUCCEEDED',
    reason: 'CANCELLATION',
    failure_code: null,
    refund_fee_amount: 4000,
  },
}

describe('parseRefundCallback', () => {
  it('membaca refund.succeeded: ketiga id & status', () => {
    expect(parseRefundCallback(succeeded)).toEqual({
      event: 'refund.succeeded',
      id: 'rfd-6f4a377d-a201-437f-9119-f8b00cbbe857',
      paymentRequestId: 'pr-90392f42-d98a-49ef-a7f3-abcezas123',
      paymentId: 'py-66269236-7447-450f-b0d8-ed4255b11d8a',
      status: 'SUCCEEDED',
      detail: 'SUCCEEDED',
    })
  })

  it('refund.failed membawa failure_code di detail', () => {
    const parsed = parseRefundCallback({
      event: 'refund.failed',
      data: { id: 'rfd-2', payment_request_id: 'pr-2', status: 'FAILED', failure_code: 'INSUFFICIENT_BALANCE' },
    })
    expect(parsed?.detail).toBe('FAILED / INSUFFICIENT_BALANCE')
  })

  it('bukan event refund → null (callback pembayaran punya field serupa)', () => {
    expect(parseRefundCallback({ event: 'payment.capture', data: { payment_request_id: 'pr-1', status: 'SUCCEEDED' } })).toBeNull()
    expect(parseRefundCallback({ event: 'ewallet.refund', data: { id: 'ewr_1', charge_id: 'ewc_1', status: 'SUCCEEDED' } })).toBeNull()
    expect(parseRefundCallback(null)).toBeNull()
  })

  it('data yang tak lengkap tetap terbaca sebagai string kosong, bukan melempar', () => {
    expect(parseRefundCallback({ event: 'refund.succeeded' })).toEqual({
      event: 'refund.succeeded',
      id: '',
      paymentRequestId: '',
      paymentId: '',
      status: '',
      detail: '',
    })
  })
})

describe('isRefundEvent & callbackEventName', () => {
  it('hanya awalan refund.', () => {
    expect(isRefundEvent('refund.succeeded')).toBe(true)
    expect(isRefundEvent('REFUND.FAILED')).toBe(true)
    expect(isRefundEvent('ewallet.refund')).toBe(false)
    expect(isRefundEvent('payment.capture')).toBe(false)
  })

  it('nama event mentah, kosong bila tak ada', () => {
    expect(callbackEventName(succeeded)).toBe('refund.succeeded')
    expect(callbackEventName({})).toBe('')
    expect(callbackEventName('bukan objek')).toBe('')
  })
})
