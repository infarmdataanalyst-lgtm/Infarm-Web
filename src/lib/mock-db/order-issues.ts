// src/lib/mock-db/order-issues.ts
// Membaca pesanan yang PERLU TINDAKAN manusia dari Supabase, lalu menilainya dengan aturan murni
// di src/lib/order-issues.ts. Dipakai kotak "Perlu tindakan" di dashboard OMS dan sumber
// notifikasi lonceng.
//
// Pola sama dengan notifications.ts: DIHITUNG dari keadaan terkini, bukan dari tabel peristiwa.
// Begitu kolomnya berubah (penjemputan terhapus, refund dicatat), pesanannya lenyap sendiri dari
// daftar — tak ada yang perlu "ditutup".
//
// SERVER-ONLY: memakai createAdminClient() (service_role). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import {
  ORDER_ISSUE_CANDIDATE_FILTER,
  ORDER_ISSUE_ORDER,
  classifyOrderIssue,
  type OrderIssueInput,
  type OrderIssueKind,
} from '@/lib/order-issues'

export type OrderIssue = {
  kind: OrderIssueKind
  invoice: string
  customer: string
  total: number
  // Waktu acuan masalahnya — untuk mengurutkan & menampilkan "sejak kapan". Bukan created_at
  // pesanan untuk semua jenis: paket yang tak dijemput dihitung sejak resinya terbit.
  since: string
}

export type OrderIssueSummary = {
  total: number
  byKind: Partial<Record<OrderIssueKind, number>>
  items: OrderIssue[]
}

// Pagar, bukan paginasi: backlog yang menembus angka ini berarti ada yang jauh lebih salah
// daripada kotak ringkasan yang terpotong.
const SOURCE_LIMIT = 500

type IssueRow = OrderIssueInput & {
  nomor_invoice: string | null
  nama_customer: string | null
  jumlah_total: number | null
}

// Penyaringan KASAR di database (ORDER_ISSUE_CANDIDATE_FILTER), penilaian TEPAT di JS —
// kriteria yang bergantung waktu (15 menit, 2 hari) tak praktis ditulis sebagai filter PostgREST.
export async function readOrderIssues(nowMs: number = Date.now()): Promise<OrderIssue[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      'nomor_invoice, nama_customer, jumlah_total, order_status, status_pembayaran, no_tracking, ' +
        'shipment_status, shipment_booked_at, refund_status, invoice_expire_error, invoice_expired_at, created_at',
    )
    .or(ORDER_ISSUE_CANDIDATE_FILTER)
    .order('created_at', { ascending: false })
    .limit(SOURCE_LIMIT)

  if (error) {
    // Termasuk kolom yang belum di-migrate. Daftar kosong lebih jujur daripada halaman yang
    // gagal dimuat — tapi tetap dicatat, karena kosong di sini bisa berarti "tak ada masalah"
    // ATAU "tak bisa membaca", dan admin tak bisa membedakannya dari layar.
    console.error('[order-issues] gagal membaca kandidat:', error.message)
    return []
  }

  const items: OrderIssue[] = []
  // `as unknown as`: string select yang dirangkai membuat pembantu tipe Supabase menyerah, pola
  // sama dengan PendingReviewRow di notifications.ts.
  for (const row of (data as unknown as IssueRow[]) ?? []) {
    const kind = classifyOrderIssue(row, nowMs)
    if (!kind) continue
    items.push({
      kind,
      invoice: row.nomor_invoice ?? '(tanpa invoice)',
      customer: row.nama_customer?.trim() || 'Pembeli',
      total: row.jumlah_total ?? 0,
      since:
        kind === 'diproses_terlalu_lama' && row.shipment_booked_at
          ? row.shipment_booked_at
          : row.created_at,
    })
  }

  // Jenis paling mendesak dulu; di dalam satu jenis, yang paling lama menunggu dulu.
  const rank = new Map(ORDER_ISSUE_ORDER.map((k, i) => [k, i]))
  items.sort((a, b) => {
    const r = (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99)
    return r !== 0 ? r : a.since.localeCompare(b.since)
  })
  return items
}

export function summarizeOrderIssues(items: OrderIssue[]): OrderIssueSummary {
  const byKind: Partial<Record<OrderIssueKind, number>> = {}
  for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
  return { total: items.length, byKind, items }
}
