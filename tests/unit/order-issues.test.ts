// tests/unit/order-issues.test.ts
// Aturan "pesanan mana yang perlu tindakan manusia". Salah di sisi longgar = alarm palsu yang
// membuat admin berhenti membaca; salah di sisi ketat = kurir datang menjemput paket yang sudah
// batal, atau uang pembeli tertahan tanpa ada yang tahu.

import { describe, expect, it } from 'vitest'
import {
  DIPROSES_TERLALU_LAMA_HARI,
  LUNAS_TANPA_RESI_MENIT,
  classifyOrderIssue,
  type OrderIssueInput,
} from '@/lib/order-issues'

const NOW = Date.parse('2026-09-23T08:00:00.000Z')
const menitLalu = (n: number) => new Date(NOW - n * 60_000).toISOString()
const hariLalu = (n: number) => new Date(NOW - n * 24 * 60 * 60_000).toISOString()

// Pesanan lunas yang sehat: diproses, resi baru terbit. Tiap test mengubah satu hal darinya.
function pesanan(over: Partial<OrderIssueInput> = {}): OrderIssueInput {
  return {
    order_status: 'PROCESSING',
    status_pembayaran: 'PAID',
    no_tracking: 'JO9001572421',
    shipment_status: 'BOOKED',
    shipment_booked_at: menitLalu(5),
    refund_status: null,
    invoice_expire_error: null,
    invoice_expired_at: null,
    created_at: menitLalu(6),
    ...over,
  }
}

describe('classifyOrderIssue', () => {
  it('pesanan sehat tidak menghasilkan apa pun', () => {
    expect(classifyOrderIssue(pesanan(), NOW)).toBeNull()
  })

  it('penjemputan gagal dihapus selalu paling mendesak (MGT-66)', () => {
    expect(
      classifyOrderIssue(
        pesanan({ order_status: 'CANCELLED', shipment_status: 'CANCEL_FAILED', refund_status: 'PERLU_REFUND' }),
        NOW,
      ),
    ).toBe('penjemputan_belum_dihapus')
  })

  it('booking gagal hanya untuk pesanan yang masih berjalan', () => {
    expect(classifyOrderIssue(pesanan({ shipment_status: 'FAILED', no_tracking: null }), NOW)).toBe('booking_gagal')
    // Sudah batal → tak butuh kurir lagi; jangan minta admin membooking pesanan yang batal.
    expect(
      classifyOrderIssue(pesanan({ order_status: 'CANCELLED', shipment_status: 'FAILED', no_tracking: null }), NOW),
    ).toBeNull()
  })

  describe('lunas tanpa resi', () => {
    it('menunggu toleransi sebelum berbunyi', () => {
      const macet = pesanan({ no_tracking: null, shipment_status: null, shipment_booked_at: null })
      expect(classifyOrderIssue({ ...macet, created_at: menitLalu(LUNAS_TANPA_RESI_MENIT - 1) }, NOW)).toBeNull()
      expect(classifyOrderIssue({ ...macet, created_at: menitLalu(LUNAS_TANPA_RESI_MENIT) }, NOW)).toBe(
        'lunas_tanpa_resi',
      )
    })

    it('tidak berbunyi untuk pesanan yang belum dibayar', () => {
      // Belum bayar = memang belum waktunya dibooking.
      expect(
        classifyOrderIssue(
          pesanan({
            status_pembayaran: 'PENDING',
            order_status: 'PENDING',
            no_tracking: null,
            shipment_status: null,
            created_at: menitLalu(60),
          }),
          NOW,
        ),
      ).toBeNull()
    })

    it('tidak menumpuk dengan booking gagal', () => {
      // FAILED sudah punya kategorinya sendiri; satu pesanan = satu baris tindakan.
      expect(
        classifyOrderIssue(
          pesanan({ no_tracking: null, shipment_status: 'FAILED', created_at: menitLalu(60) }),
          NOW,
        ),
      ).toBe('booking_gagal')
    })
  })

  it('tagihan yang gagal dimatikan hanya untuk pesanan batal yang belum kedaluwarsa', () => {
    const batal = pesanan({ order_status: 'CANCELLED', shipment_status: 'CANCELLED', invoice_expire_error: 'HTTP 500' })
    expect(classifyOrderIssue(batal, NOW)).toBe('tagihan_masih_hidup')
    // Sudah tercatat kedaluwarsa → galat lama tak lagi relevan.
    expect(classifyOrderIssue({ ...batal, invoice_expired_at: menitLalu(1) }, NOW)).toBeNull()
  })

  it('refund yang belum selesai ikut dihitung, termasuk yang sedang diproses', () => {
    const batal = pesanan({ order_status: 'CANCELLED', shipment_status: 'CANCELLED' })
    expect(classifyOrderIssue({ ...batal, refund_status: 'PERLU_REFUND' }, NOW)).toBe('perlu_refund')
    expect(classifyOrderIssue({ ...batal, refund_status: 'SEDANG_DIPROSES' }, NOW)).toBe('perlu_refund')
    expect(classifyOrderIssue({ ...batal, refund_status: 'SUDAH_REFUND' }, NOW)).toBeNull()
    expect(classifyOrderIssue({ ...batal, refund_status: 'TIDAK_PERLU' }, NOW)).toBeNull()
  })

  describe('diproses terlalu lama', () => {
    it('diukur dari terbitnya resi, bukan dari dibuatnya pesanan', () => {
      // Pesanan lama yang resinya baru terbit kemarin: kurir belum terlambat.
      expect(
        classifyOrderIssue(pesanan({ created_at: hariLalu(10), shipment_booked_at: hariLalu(1) }), NOW),
      ).toBeNull()
      expect(
        classifyOrderIssue(pesanan({ shipment_booked_at: hariLalu(DIPROSES_TERLALU_LAMA_HARI) }), NOW),
      ).toBe('diproses_terlalu_lama')
    })

    it('berhenti berbunyi begitu status naik ke Dikirim', () => {
      expect(
        classifyOrderIssue(pesanan({ order_status: 'SHIPPED', shipment_booked_at: hariLalu(10) }), NOW),
      ).toBeNull()
    })
  })

  // NOW = 23 Sep 2026 08.00 UTC = 15.00 WIB, Rabu. "Hari ini" dalam WIB = 2026-09-23.
  describe('jadwal jemput terlewat (pesanan dengan pickup_date)', () => {
    it('berbunyi begitu tanggal jemput lewat, tanpa menunggu 2 hari', () => {
      expect(
        classifyOrderIssue(pesanan({ pickup_date: '2026-09-22', shipment_booked_at: hariLalu(1) }), NOW),
      ).toBe('jadwal_jemput_terlewat')
    })

    it('diam selama hari jemputnya belum berganti, meski sudah malam', () => {
      expect(classifyOrderIssue(pesanan({ pickup_date: '2026-09-23' }), NOW)).toBeNull()
    })

    it('jadwal di masa depan (libur panjang) MEMBUNGKAM aturan 2 hari', () => {
      // Dibooking 5 hari lalu, tapi jadwal jemputnya memang masih Senin depan. Tanpa cabang ini,
      // aturan diproses_terlalu_lama berbunyi palsu sepanjang libur.
      expect(
        classifyOrderIssue(pesanan({ pickup_date: '2026-09-28', shipment_booked_at: hariLalu(5) }), NOW),
      ).toBeNull()
    })

    it('tanggal WIB, bukan UTC: 01.00 WIB sudah hari berikutnya', () => {
      // 23 Sep 18.00 UTC = 24 Sep 01.00 WIB → jadwal 23 Sep sudah lewat.
      const dini = Date.parse('2026-09-23T18:00:00.000Z')
      expect(classifyOrderIssue(pesanan({ pickup_date: '2026-09-23' }), dini)).toBe('jadwal_jemput_terlewat')
    })

    it('berhenti begitu status naik ke Dikirim atau pesanan batal', () => {
      expect(classifyOrderIssue(pesanan({ pickup_date: '2026-09-20', order_status: 'SHIPPED' }), NOW)).toBeNull()
      expect(
        classifyOrderIssue(
          pesanan({ pickup_date: '2026-09-20', order_status: 'CANCELLED', shipment_status: 'CANCELLED' }),
          NOW,
        ),
      ).toBeNull()
    })

    it('pesanan lama tanpa pickup_date tetap memakai aturan 2 hari', () => {
      expect(
        classifyOrderIssue(pesanan({ pickup_date: null, shipment_booked_at: hariLalu(DIPROSES_TERLALU_LAMA_HARI) }), NOW),
      ).toBe('diproses_terlalu_lama')
    })
  })
})
