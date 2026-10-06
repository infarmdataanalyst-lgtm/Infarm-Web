// tests/unit/cdn-cache.test.ts
// Header cache CDN untuk API publik. Yang mahal kalau salah: lupa `s-maxage` (setiap pengunjung
// menjalankan server lagi), atau jalur ?fresh=1 ikut tersimpan CDN (OMS & muat ulang promo setelah
// kuota habis menerima data basi).

import { describe, expect, it } from 'vitest'
import {
  freshUrl,
  NO_STORE_CACHE_CONTROL,
  PUBLIC_CDN_CACHE_CONTROL,
  publicCacheControl,
  publicCacheHeaders,
} from '@/lib/cdn-cache'

const req = (path: string) => new Request(`https://infarm.id${path}`)

describe('publicCacheControl', () => {
  it('permintaan biasa → boleh disimpan CDN 60 dtk, browser selalu bertanya ulang', () => {
    expect(publicCacheControl(req('/api/products/list'))).toBe(PUBLIC_CDN_CACHE_CONTROL)
    expect(PUBLIC_CDN_CACHE_CONTROL).toContain('s-maxage=60')
    expect(PUBLIC_CDN_CACHE_CONTROL).toContain('max-age=0')
    expect(PUBLIC_CDN_CACHE_CONTROL).toContain('stale-while-revalidate=60')
  })

  it('query lain tetap di-cache (kunci CDN memuat query string)', () => {
    expect(publicCacheControl(req('/api/products/search?q=benih'))).toBe(PUBLIC_CDN_CACHE_CONTROL)
    expect(publicCacheControl(req('/api/products/by-ids?ids=a,b'))).toBe(PUBLIC_CDN_CACHE_CONTROL)
  })

  it('?fresh=1 → tidak disimpan di mana pun', () => {
    expect(publicCacheControl(req('/api/products/list?fresh=1'))).toBe(NO_STORE_CACHE_CONTROL)
    expect(publicCacheControl(req('/api/products/search?q=x&fresh=1'))).toBe(NO_STORE_CACHE_CONTROL)
  })

  it('nilai fresh selain 1 tidak dianggap jalur segar', () => {
    expect(publicCacheControl(req('/api/products/list?fresh=0'))).toBe(PUBLIC_CDN_CACHE_CONTROL)
  })

  it('publicCacheHeaders membungkusnya sebagai header Cache-Control', () => {
    expect(publicCacheHeaders(req('/api/combos/active'))).toEqual({ 'Cache-Control': PUBLIC_CDN_CACHE_CONTROL })
  })
})

describe('freshUrl', () => {
  it('menambahkan ?fresh=1 atau &fresh=1 sesuai ada-tidaknya query', () => {
    expect(freshUrl('/api/promotions/active')).toBe('/api/promotions/active?fresh=1')
    expect(freshUrl('/api/products/search?q=a')).toBe('/api/products/search?q=a&fresh=1')
  })
})
