// src/app/api/oms/refunds/route.ts
// Daftar kerja pengembalian dana + penutupannya. Wajib sesi admin.
//
//   GET   → pesanan berstatus PERLU_REFUND
//   PATCH → tutup satu baris: SUDAH_REFUND (dengan nominal & catatan) atau TIDAK_PERLU
//
// ── Kenapa pencatatan manual, bukan refund otomatis ──
// Terverifikasi 2026-09-10: pembayaran lewat Virtual Account / transfer bank TIDAK BISA di-refund
// Xendit sama sekali. Pengembaliannya adalah transfer BARU ke rekening pembeli, dijalankan manusia
// dari dashboard. Untuk pesanan seperti itu, catatan di sini bukan solusi sementara — ia
// satu-satunya jejak yang akan pernah ada.
//
// E-wallet memang bisa otomatis (POST /ewallets/charges/{ewc_...}/refunds), tapi belum dibangun.
// Saat nanti dibangun, ia menulis ke kolom yang SAMA — jadi daftar ini tetap berlaku.

import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminRole, getAdminIdentity } from '@/lib/oms-guard'
import { readOrdersNeedingRefund, resolveRefund, getOrderByOrderId } from '@/lib/mock-db/orders'
import { normalizeInvoiceId } from '@/lib/invoice-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // requireAdmin, bukan requireAdminRole: staf boleh MELIHAT siapa yang masih menunggu uangnya —
  // itu pertanyaan yang wajar diterima CS dari pembeli. Yang dibatasi adalah menutupnya.
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  // Yang dikirim adalah RefundWorkItem, BUKAN Order utuh (SEC-048). Karena pagarnya sengaja
  // longgar di atas, muatannya yang harus sempit: `Order` membawa alamat lengkap, `invoiceUrl`
  // yang bisa jadi masih bisa dibayar, dan `mengantarObjectId` yang cukup untuk menghapus
  // penjemputan — tak satu pun dipakai halaman ini.
  const orders = await readOrdersNeedingRefund()
  return NextResponse.json({ orders })
}

export async function PATCH(request: Request) {
  // Menutup baris = menyatakan uang sudah dikirim. Itu pernyataan keuangan, jadi peran 'admin'.
  const denied = await requireAdminRole('Akun Anda tidak berwenang menutup pengembalian dana.')
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  // Bentuknya divalidasi, bukan sekadar dirapikan (SEC-052) — nilai ini ikut masuk ke log.
  const orderId = normalizeInvoiceId(body.orderId)
  const status = body.status
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  if (!orderId) {
    return NextResponse.json(
      { error: 'orderId wajib ada dan berbentuk nomor invoice.' },
      { status: 400 },
    )
  }
  if (status !== 'SUDAH_REFUND' && status !== 'TIDAK_PERLU') {
    return NextResponse.json(
      { error: 'status harus SUDAH_REFUND atau TIDAK_PERLU.' },
      { status: 400 },
    )
  }
  // Catatan WAJIB untuk kedua cabang. Pengembalian dana jalur transfer bank terjadi di luar sistem
  // ini; tanpa nomor referensi atau alasan yang diketik admin, baris yang ditutup tak bisa
  // dibedakan dari baris yang sekadar diklik supaya daftarnya bersih.
  if (note.length < 3) {
    return NextResponse.json(
      {
        error:
          status === 'SUDAH_REFUND'
            ? 'Isi catatan: bank & nomor rekening tujuan, atau nomor referensi transfer.'
            : 'Isi alasan mengapa pengembalian dana tidak diperlukan.',
      },
      { status: 422 },
    )
  }

  // Pesanannya dibaca lebih dulu — dibutuhkan batas atas nominal di bawah, dan sekaligus membuat
  // invoice yang tak ada dijawab 404 alih-alih 409 "sudah ditutup admin lain" yang menyesatkan.
  const order = await getOrderByOrderId(orderId)
  if (!order) {
    return NextResponse.json({ error: `Pesanan ${orderId} tidak ditemukan.` }, { status: 404 })
  }

  // Nominal hanya untuk SUDAH_REFUND, dan WAJIB — biaya transfer boleh dipotong, jadi yang
  // benar-benar diterima pembeli tak bisa disimpulkan dari jumlah_total.
  let amount = 0
  if (status === 'SUDAH_REFUND') {
    const raw = typeof body.amount === 'number' ? body.amount : Number(body.amount)
    if (!Number.isFinite(raw) || raw < 0) {
      return NextResponse.json(
        { error: 'Isi nominal yang benar-benar dikembalikan (boleh 0 bila habis dipotong biaya).' },
        { status: 422 },
      )
    }
    // Batas atas (SEC-053). Endpoint ini tak memindahkan uang — ia mencatat — tapi catatan yang
    // melebihi nilai pesanan merusak rekonsiliasi, dan angka seperti 1e15 bisa melampaui jangkauan
    // kolomnya. Pengembalian tak pernah melebihi yang dibayar, jadi itulah batasnya; pemotongan
    // biaya transfer tetap bisa dicatat karena yang dibatasi hanya sisi ATASnya.
    if (raw > order.totalAmount) {
      return NextResponse.json(
        {
          error: `Nominal melebihi nilai pesanan (${order.totalAmount}). Pengembalian tak pernah lebih besar daripada yang dibayar.`,
          code: 'AMOUNT_TOO_LARGE',
        },
        { status: 422 },
      )
    }
    amount = raw
  }

  // Nama admin ikut dicatat — bukan sekadar "seorang admin". Kalau pembeli mengaku belum menerima
  // dananya, pertanyaan pertama adalah siapa yang mengirim dan kapan.
  const identity = await getAdminIdentity()
  const by = identity?.name?.trim() || 'admin'

  const updated = await resolveRefund(
    orderId,
    status === 'SUDAH_REFUND'
      ? { status: 'SUDAH_REFUND', amount, note, by }
      : { status: 'TIDAK_PERLU', note, by },
  )

  if (!updated) {
    // resolveRefund memakai compare-and-swap pada refund_status: null di sini berarti barisnya
    // sudah ditutup orang lain lebih dulu. Bukan galat sistem — dan penting dibedakan, karena
    // memberitahu admin "gagal" akan membuatnya mencoba mengirim uang untuk kedua kalinya.
    return NextResponse.json(
      {
        error:
          'Pesanan ini sudah ditutup oleh admin lain, atau statusnya berubah. Muat ulang halaman.',
        code: 'ALREADY_RESOLVED',
      },
      { status: 409 },
    )
  }

  console.log(`[oms/refunds] ${orderId} → ${status} oleh ${by}`)
  return NextResponse.json({ success: true, order: updated })
}
