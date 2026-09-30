// tests/unit/payment-method.test.ts
// Pembacaan orders.metode_pembayaran dari DUA generasi kode kanal Xendit. Yang mahal kalau salah:
// keluarga menentukan jalur refund yang ditawarkan ke admin — VA salah terbaca sebagai e-wallet
// berarti tombol refund otomatis yang pasti ditolak, dan sebaliknya berarti CS meminta nomor
// rekening untuk pembayaran yang bisa dikembalikan ke sumbernya.

import { describe, expect, it } from 'vitest'
import { normalizeChannelKey, paymentMethodInfo, paymentMethodLabel } from '@/lib/payment-method'

describe('normalizeChannelKey', () => {
  it('kode pendek era Invoice v2 tak berubah', () => {
    expect(normalizeChannelKey('bca')).toBe('BCA')
    expect(normalizeChannelKey('OVO')).toBe('OVO')
    expect(normalizeChannelKey('bank transfer')).toBe('BANK_TRANSFER')
  })

  it('akhiran _VIRTUAL_ACCOUNT v3 dilucuti', () => {
    expect(normalizeChannelKey('BCA_VIRTUAL_ACCOUNT')).toBe('BCA')
    expect(normalizeChannelKey('BSS_VIRTUAL_ACCOUNT')).toBe('BSS')
  })

  it('direct debit dibedakan dari VA bank yang sama', () => {
    expect(normalizeChannelKey('BRI_DIRECT_DEBIT')).toBe('DD_BRI')
    expect(normalizeChannelKey('BRI_VIRTUAL_ACCOUNT')).toBe('BRI')
    expect(normalizeChannelKey('DIRECT_DEBIT')).toBe('DIRECT_DEBIT')
  })

  it('awalan negara & varian autodebit e-wallet dilucuti', () => {
    expect(normalizeChannelKey('ID_SHOPEEPAY')).toBe('SHOPEEPAY')
    expect(normalizeChannelKey('ID_DANA_AUTODEBIT')).toBe('DANA')
  })
})

describe('paymentMethodInfo', () => {
  it('VA v3 → transfer-bank dengan nama bank pendek', () => {
    expect(paymentMethodInfo('BCA_VIRTUAL_ACCOUNT')).toEqual({ channel: 'BCA', family: 'transfer-bank', familyLabel: 'Transfer Bank' })
    expect(paymentMethodInfo('BSS_VIRTUAL_ACCOUNT')?.channel).toBe('Sahabat Sampoerna')
  })

  it('direct debit BRI → keluarga direct-debit (bisa di-refund), label BRI', () => {
    expect(paymentMethodInfo('BRI_DIRECT_DEBIT')).toEqual({ channel: 'BRI', family: 'direct-debit', familyLabel: 'Direct Debit' })
  })

  it('e-wallet dari kedua generasi', () => {
    expect(paymentMethodInfo('SHOPEEPAY')?.family).toBe('e-wallet')
    expect(paymentMethodInfo('ID_SHOPEEPAY')).toEqual({ channel: 'ShopeePay', family: 'e-wallet', familyLabel: 'Dompet Digital' })
    expect(paymentMethodInfo('DANA')?.family).toBe('e-wallet')
  })

  it('QRIS', () => {
    expect(paymentMethodInfo('QRIS')?.family).toBe('qris')
  })

  it('kosong → null; tak dikenal → lain dengan nama apa adanya', () => {
    expect(paymentMethodInfo(null)).toBeNull()
    expect(paymentMethodInfo('   ')).toBeNull()
    expect(paymentMethodInfo('KANAL_BARU')).toEqual({ channel: 'KANAL_BARU', family: 'lain', familyLabel: 'Lainnya' })
  })
})

describe('paymentMethodLabel', () => {
  it('channel · keluarga, kecuali bila sama atau tak dikenal', () => {
    expect(paymentMethodLabel('BCA_VIRTUAL_ACCOUNT')).toBe('BCA · Transfer Bank')
    expect(paymentMethodLabel('BRI_DIRECT_DEBIT')).toBe('BRI · Direct Debit')
    expect(paymentMethodLabel('QRIS')).toBe('QRIS')
    expect(paymentMethodLabel('DIRECT_DEBIT')).toBe('Direct Debit')
    expect(paymentMethodLabel('KANAL_BARU')).toBe('KANAL_BARU')
    expect(paymentMethodLabel(undefined)).toBeNull()
  })
})
