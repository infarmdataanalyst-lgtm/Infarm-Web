// tests/unit/ga-referrer-override.test.ts
// Skrip penimpa perujuk GA4. Yang mahal kalau salah: atribusi pembeli asli hilang (pencocokan terlalu
// longgar), halaman rusak karena galat skrip, atau perintah tak terbaca gtag.js (bentuk dataLayer
// salah). Yang diuji adalah TEKS skrip yang benar-benar dikirim ke browser, dijalankan dengan
// window/document tiruan — bukan salinan logikanya.

import { describe, expect, it } from 'vitest'
import { buildReferrerOverrideScript } from '@/lib/ga-referrer-override'

const ORIGIN = 'https://infarm.id'

// Menjalankan skrip dengan perujuk tertentu; mengembalikan isi dataLayer sesudahnya.
function run(referrer: string, existing?: unknown[]): unknown[] | undefined {
  const window: { dataLayer?: unknown[] } = existing ? { dataLayer: existing } : {}
  const document = { referrer }
  const location = { origin: ORIGIN }
  new Function('window', 'document', 'location', buildReferrerOverrideScript())(window, document, location)
  return window.dataLayer
}

// Isi satu perintah gtag (objek `arguments`) sebagai array biasa.
const asArgs = (entry: unknown) => Array.from(entry as ArrayLike<unknown>)

describe('buildReferrerOverrideScript', () => {
  it.each([
    'https://checkout-staging.xendit.co/',
    'https://checkout.xendit.co/web/abc123',
    'https://xendit.co/',
    'https://XEN.TO/abc',
  ])('perujuk pembayaran %s → page_referrer diganti halaman checkout toko', (referrer) => {
    const layer = run(referrer)
    expect(layer).toHaveLength(1)
    expect(asArgs(layer![0])).toEqual(['set', { page_referrer: `${ORIGIN}/checkout` }])
  })

  it('perintah didorong sebagai objek arguments, bukan array (bentuk yang dibaca gtag.js)', () => {
    const layer = run('https://checkout.xendit.co/')
    expect(Array.isArray(layer![0])).toBe(false)
    expect(Object.prototype.toString.call(layer![0])).toBe('[object Arguments]')
  })

  it('dataLayer yang sudah ada dipertahankan, perintah ditambahkan di belakangnya', () => {
    const existing: unknown[] = [{ event: 'lain' }]
    const layer = run('https://checkout.xendit.co/', existing)
    expect(layer).toBe(existing)
    expect(layer).toHaveLength(2)
  })

  it.each([
    'https://www.instagram.com/',
    'https://www.google.com/',
    'https://infarm.id/produk/abc',
    'https://xendit.co.situs-lain.com/',
    'https://notxendit.co/',
    'https://xen.top/',
    'https://xendit.com/',
  ])('perujuk lain %s → tidak disentuh', (referrer) => {
    expect(run(referrer)).toBeUndefined()
  })

  it('tanpa perujuk (kunjungan langsung) → tidak disentuh', () => {
    expect(run('')).toBeUndefined()
  })

  it('perujuk tak valid tidak melempar galat ke halaman', () => {
    expect(() => run('bukan url')).not.toThrow()
    expect(run('bukan url')).toBeUndefined()
  })
})
