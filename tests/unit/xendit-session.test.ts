// tests/unit/xendit-session.test.ts
// Payload `POST /sessions` — bagian MURNI dari lib/xendit/session.ts. Yang mahal kalau salah:
// reference_id (kunci webhook), nominal, dan return URL yang non-https (Xendit menolak seluruh
// sesi dengan INVALID_URL).

import { describe, expect, it } from 'vitest'
import { allowedChannelsFromEnv, buildSessionPayload, SESSION_DURATION_SECONDS } from '@/lib/xendit/session'
import type { Order } from '@/types/order'

const order = {
  orderId: 'INV-20260928-ABCDEFGH',
  customerName: 'Budi Santoso',
  customerEmail: 'budi@example.com',
  customerPhone: '081234567890',
  totalAmount: 79080,
  items: [
    { productId: 'p1', productName: 'Sprayer 2L', quantity: 2, price: 46000 },
  ],
} as unknown as Order

const now = new Date('2026-09-28T03:00:00.000Z')

describe('buildSessionPayload', () => {
  it('menyusun sesi PAYMENT_LINK dengan reference_id = nomor invoice dan nominal apa adanya', () => {
    const payload = buildSessionPayload(order, 'https://infarm-web-mu.vercel.app', { now })
    expect(payload).toMatchObject({
      reference_id: 'INV-20260928-ABCDEFGH',
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      amount: 79080,
      currency: 'IDR',
      country: 'ID',
      locale: 'id',
      expires_at: new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000).toISOString(),
      success_return_url: 'https://infarm-web-mu.vercel.app/checkout/success?invoice=INV-20260928-ABCDEFGH',
      cancel_return_url: 'https://infarm-web-mu.vercel.app/checkout/success?invoice=INV-20260928-ABCDEFGH',
      notification_channels: ['EMAIL'],
      customer: {
        reference_id: `INV-20260928-ABCDEFGH-${now.getTime()}`,
        type: 'INDIVIDUAL',
        email: 'budi@example.com',
        mobile_number: '+6281234567890',
        individual_detail: { given_names: 'Budi Santoso' },
      },
      metadata: { nomor_invoice: 'INV-20260928-ABCDEFGH' },
    })
    // Tidak ada items, tidak ada filter kanal.
    expect(payload).not.toHaveProperty('items')
    expect(payload).not.toHaveProperty('allowed_payment_channels')
  })

  it('customer.reference_id wajib ada dan berbeda tiap percobaan untuk pesanan yang sama', () => {
    const a = buildSessionPayload(order, 'https://infarm.id', { now })
    const b = buildSessionPayload(order, 'https://infarm.id', { now: new Date(now.getTime() + 60_000) })
    const refA = (a.customer as Record<string, unknown>).reference_id
    const refB = (b.customer as Record<string, unknown>).reference_id
    expect(refA).toMatch(/^INV-20260928-ABCDEFGH-\d+$/)
    expect(refA).not.toBe(refB)
  })

  it('origin http (dev lokal) → return URL dihilangkan, bukan dikirim non-https', () => {
    const payload = buildSessionPayload(order, 'http://localhost:3000', { now })
    expect(payload).not.toHaveProperty('success_return_url')
    expect(payload).not.toHaveProperty('cancel_return_url')
  })

  it('garis miring di akhir origin tak menggandakan pemisah path', () => {
    const payload = buildSessionPayload(order, 'https://infarm.id/', { now })
    expect(payload.success_return_url).toBe('https://infarm.id/checkout/success?invoice=INV-20260928-ABCDEFGH')
  })

  it('tanpa email → blok customer & notifikasi tak dikirim sama sekali', () => {
    const payload = buildSessionPayload({ ...order, customerEmail: undefined } as Order, 'https://infarm.id', { now })
    expect(payload).not.toHaveProperty('customer')
    expect(payload).not.toHaveProperty('notification_channels')
  })

  it('nomor telepon tak valid → mobile_number dihilangkan, bukan dikirim kosong', () => {
    const payload = buildSessionPayload({ ...order, customerPhone: 'abc' } as Order, 'https://infarm.id', { now })
    expect(payload.customer as Record<string, unknown>).not.toHaveProperty('mobile_number')
  })

  it('daftar kanal dikirim hanya bila diberikan', () => {
    const payload = buildSessionPayload(order, 'https://infarm.id', { now, allowedChannels: ['QRIS', 'DANA'] })
    expect(payload.allowed_payment_channels).toEqual(['QRIS', 'DANA'])
  })

  it('durasi bisa ditimpa (dipakai bila Xendit menolak 24 jam)', () => {
    const payload = buildSessionPayload(order, 'https://infarm.id', { now, durationSeconds: 3600 })
    expect(payload.expires_at).toBe('2026-09-28T04:00:00.000Z')
  })
})

describe('allowedChannelsFromEnv', () => {
  it('kosong / spasi → undefined (tidak dikirim)', () => {
    expect(allowedChannelsFromEnv(undefined)).toBeUndefined()
    expect(allowedChannelsFromEnv('')).toBeUndefined()
    expect(allowedChannelsFromEnv(' , ,')).toBeUndefined()
  })

  it('dipisah koma, dikapitalkan, tanpa duplikat', () => {
    expect(allowedChannelsFromEnv(' qris, dana ,QRIS,BCA_VIRTUAL_ACCOUNT')).toEqual(['QRIS', 'DANA', 'BCA_VIRTUAL_ACCOUNT'])
  })
})
