// tests/unit/mengantar-booking-response.test.ts
// Penolakan kurir di respons POST /order yang tetap ber-`success: true`.
//
// Yang MAHAL kalau salah: menganggap penolakan sebagai booking berhasil (tak ada) — atau, seperti
// sebelum 2026-10-05, menyimpan potongan respons yang berhenti tepat sebelum alasannya.

import { describe, expect, it } from 'vitest'
import { describeCourierRejection } from '@/lib/mengantar-booking-response'

// Dibangun dari respons sungguhan INV-20261005-YV2GX0NS (SPX → Gomo, Nias Selatan). Bagian yang
// tersimpan di shipment_error terpotong di `createdDate`; sisanya di sini sengaja tanpa field alasan.
const ditolakTanpaAlasan = {
  success: true,
  data: [
    {
      COD_AMOUNT: 0,
      status: 'error',
      statusCategory: 'error',
      isPaid: true,
      isPreviouslyError: true,
      cargo: false,
      _id: '6ac344e96e4ade8c8bc457e5',
      createdDate: '2026-10-05T06:34:17.000Z',
    },
  ],
}

describe('describeCourierRejection', () => {
  it('mengenali item berstatus error tanpa resi dan menyimpan _id-nya', () => {
    const hasil = describeCourierRejection(ditolakTanpaAlasan)
    expect(hasil).not.toBeNull()
    expect(hasil).toContain('_id=6ac344e96e4ade8c8bc457e5')
  })

  it('tanpa field alasan: menyimpan isi item, bukan sekadar "tak ada alasan"', () => {
    const hasil = describeCourierRejection(ditolakTanpaAlasan) ?? ''
    expect(hasil).toContain('Mengantar tak menyertakan alasan')
    expect(hasil).toContain('"statusCategory":"error"')
  })

  it('mengambil field alasan bila ada, dan tak menganggap isPreviouslyError sebagai alasan', () => {
    const body = {
      success: true,
      data: [
        {
          ...ditolakTanpaAlasan.data[0],
          errorMessage: 'Destination not covered by SPX',
        },
      ],
    }
    const hasil = describeCourierRejection(body)
    expect(hasil).toBe('_id=6ac344e96e4ade8c8bc457e5; errorMessage=Destination not covered by SPX')
  })

  it('bukan penolakan bila resi sudah terbit, apa pun status lainnya', () => {
    const body = {
      success: true,
      data: [{ ...ditolakTanpaAlasan.data[0], cnote_no: 'SPXID06951677587A' }],
    }
    expect(describeCourierRejection(body)).toBeNull()
  })

  it('bukan penolakan untuk booking sukses biasa', () => {
    const body = {
      success: true,
      data: [{ _id: 'abc', cnote_no: 'JO7407074858', SERVICE_CODE: 'REG', status: 'pending' }],
    }
    expect(describeCourierRejection(body)).toBeNull()
  })

  it('bukan penolakan untuk bentuk yang tak dikenal', () => {
    expect(describeCourierRejection(null)).toBeNull()
    expect(describeCourierRejection({ success: true })).toBeNull()
    expect(describeCourierRejection({ success: true, data: [] })).toBeNull()
    expect(describeCourierRejection({ success: true, data: [{ status: 'pending' }] })).toBeNull()
  })
})
