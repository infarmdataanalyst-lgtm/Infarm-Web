// tests/unit/ga-refund.test.ts
// reportRefundToGa: kapan event `refund` dikirim, kapan dilewati, dan kapan klaimnya dilepas.
//
// Yang MAHAL kalau salah: refund terkirim dua kali (revenue minus untuk satu transaksi), atau
// pesanan ditandai "sudah dilaporkan" padahal tak pernah terkirim (hilang dari daftar susulan).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '@/types/order'
import type { GaRefundClaim } from '@/lib/mock-db/orders'
import type { SendResult } from '@/lib/analytics-server'

const state = {
  skip: null as 'not-configured' | 'no-client-id' | null,
  claim: 'CLAIMED' as GaRefundClaim,
  send: { ok: true } as SendResult,
}
const claimGaRefundSend = vi.fn(async () => state.claim)
const releaseGaRefundClaim = vi.fn(async () => undefined)
const sendRefundEvent = vi.fn(async () => state.send)

vi.mock('@/lib/analytics-server', () => ({
  gaSkipReason: () => state.skip,
  sendRefundEvent,
}))
vi.mock('@/lib/mock-db/orders', () => ({ claimGaRefundSend, releaseGaRefundClaim }))

const refunded = {
  orderId: 'INV-20261005-REFUND01',
  totalAmount: 34212,
  refundStatus: 'SUDAH_REFUND',
  gaClientId: '1.1',
  items: [],
} as unknown as Order

describe('reportRefundToGa', () => {
  beforeEach(() => {
    state.skip = null
    state.claim = 'CLAIMED'
    state.send = { ok: true }
    claimGaRefundSend.mockClear()
    releaseGaRefundClaim.mockClear()
    sendRefundEvent.mockClear()
  })

  it('SUDAH_REFUND + klaim menang → terkirim sekali', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('SENT')
    expect(sendRefundEvent).toHaveBeenCalledTimes(1)
  })

  it('klaim sudah dipegang pihak lain → tak mengirim', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.claim = 'TAKEN'
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('ALREADY_REPORTED')
    expect(sendRefundEvent).not.toHaveBeenCalled()
  })

  it('belum SUDAH_REFUND (mis. SEDANG_DIPROSES) → tak menyentuh apa pun', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    const diproses = { ...refunded, refundStatus: 'SEDANG_DIPROSES' } as Order
    expect(await reportRefundToGa(diproses, '[uji]')).toBe('SKIPPED_NOT_REFUNDED')
    expect(claimGaRefundSend).not.toHaveBeenCalled()
  })

  it('tanpa client_id → dilewati TANPA klaim (purchase-nya pun tak pernah ada)', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.skip = 'no-client-id'
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('SKIPPED_NO_CLIENT_ID')
    expect(claimGaRefundSend).not.toHaveBeenCalled()
  })

  it('env GA kosong → dilewati TANPA klaim, supaya tetap masuk daftar susulan', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.skip = 'not-configured'
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('SKIPPED_NOT_CONFIGURED')
    expect(claimGaRefundSend).not.toHaveBeenCalled()
  })

  it('ditolak GA4 (non-2xx) → klaim dilepas agar bisa disusulkan', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.send = { ok: false, reason: 'http-error' }
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('FAILED')
    expect(releaseGaRefundClaim).toHaveBeenCalledWith(refunded.orderId)
  })

  it('timeout/jaringan → klaim DIPERTAHANKAN (mungkin sudah sampai; susulan = refund ganda)', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.send = { ok: false, reason: 'network' }
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('FAILED')
    expect(releaseGaRefundClaim).not.toHaveBeenCalled()
  })

  it('kolom belum di-migrate (UNAVAILABLE) → tetap mengirim', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    state.claim = 'UNAVAILABLE'
    expect(await reportRefundToGa(refunded, '[uji]')).toBe('SENT')
  })

  it('galat tak terduga tak pernah dilempar ke pemanggil', async () => {
    const { reportRefundToGa } = await import('@/lib/ga-refund')
    claimGaRefundSend.mockRejectedValueOnce(new Error('db mati'))
    await expect(reportRefundToGa(refunded, '[uji]')).resolves.toBe('FAILED')
  })
})
