// tests/unit/notification-groups.test.ts
// Tab jenis notifikasi OMS. Yang MAHAL kalau salah: stok habis jatuh ke tab yang keliru (lagi-lagi
// tak terlihat dari tempat admin mencarinya), atau urutan "pesanan bermasalah dulu" rusak.

import { describe, expect, it } from 'vitest'
import {
  countByGroup,
  filterByGroup,
  groupOfType,
  parseNotificationGroup,
  type NotificationTypeKey,
} from '@/lib/notification-groups'

const daftar: { id: string; type: NotificationTypeKey }[] = [
  { id: 'issue:booking_gagal:A', type: 'pesanan_bermasalah' },
  { id: 'issue:booking_gagal:B', type: 'pesanan_bermasalah' },
  { id: 'review:1', type: 'ulasan_baru' },
  { id: 'stock:bayam', type: 'stok_habis' },
  { id: 'gift:x', type: 'stok_hadiah' },
]

describe('groupOfType', () => {
  it('stok habis dan stok hadiah sama-sama masuk tab Stok', () => {
    expect(groupOfType('stok_habis')).toBe('stok')
    expect(groupOfType('stok_hadiah')).toBe('stok')
  })

  it('pesanan bermasalah → Pesanan, ulasan baru → Ulasan', () => {
    expect(groupOfType('pesanan_bermasalah')).toBe('pesanan')
    expect(groupOfType('ulasan_baru')).toBe('ulasan')
  })
})

describe('filterByGroup', () => {
  it('tab Stok hanya berisi stok, urutannya tetap', () => {
    expect(filterByGroup(daftar, 'stok').map((n) => n.id)).toEqual(['stock:bayam', 'gift:x'])
  })

  it('tab Semua mengembalikan daftar utuh tanpa mengubah urutan', () => {
    expect(filterByGroup(daftar, 'semua')).toEqual(daftar)
  })
})

describe('countByGroup', () => {
  it('menghitung per tab, Semua = seluruhnya', () => {
    expect(countByGroup(daftar)).toEqual({ semua: 5, pesanan: 2, stok: 2, ulasan: 1 })
  })

  it('daftar kosong → semua nol', () => {
    expect(countByGroup([])).toEqual({ semua: 0, pesanan: 0, stok: 0, ulasan: 0 })
  })
})

describe('parseNotificationGroup', () => {
  it('membaca nilai yang dikenal', () => {
    expect(parseNotificationGroup('stok')).toBe('stok')
  })

  it('nilai kosong / tak dikenal jatuh ke Semua, bukan galat', () => {
    expect(parseNotificationGroup(null)).toBe('semua')
    expect(parseNotificationGroup('')).toBe('semua')
    expect(parseNotificationGroup('STOK')).toBe('semua')
    expect(parseNotificationGroup('<script>')).toBe('semua')
  })
})
