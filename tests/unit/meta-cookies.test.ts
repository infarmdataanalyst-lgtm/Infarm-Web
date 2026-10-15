// tests/unit/meta-cookies.test.ts
// Nilai cookie ini kelak terkirim ke Meta atas nama toko, dan Meta menerima string apa pun tanpa
// mengeluh. Parser harus MENOLAK bentuk tak dikenal, bukan menebak.

import { describe, expect, it } from 'vitest'
import { parseMetaCookie } from '@/lib/meta-cookies'

describe('parseMetaCookie', () => {
  it('menerima _fbp dan _fbc berbentuk fb.<n>.<ms>.<id>', () => {
    expect(parseMetaCookie('fb.1.1696000000000.1234567890')).toBe('fb.1.1696000000000.1234567890')
    expect(parseMetaCookie(' fb.1.1696000000000.IwAR0abc_DEF-123 ')).toBe('fb.1.1696000000000.IwAR0abc_DEF-123')
  })

  it('menolak bentuk lain', () => {
    expect(parseMetaCookie('')).toBeUndefined()
    expect(parseMetaCookie('fb.1.1696000000000')).toBeUndefined() // kurang satu bagian
    expect(parseMetaCookie('ga.1.1696000000000.abc')).toBeUndefined() // bukan awalan fb
    expect(parseMetaCookie('fb.1.abc.def')).toBeUndefined() // stempel bukan angka
    expect(parseMetaCookie('fb.1.1696000000000.<script>')).toBeUndefined() // karakter di luar fbclid
    expect(parseMetaCookie(`fb.1.1696000000000.${'a'.repeat(201)}`)).toBeUndefined() // terlalu panjang
  })
})
