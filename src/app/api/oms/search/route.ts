// src/app/api/oms/search/route.ts
// Pencarian cepat dari search bar header OMS.
//   GET ?q=<teks>  → pesanan yang cocok, dalam bentuk ramping (lihat types/oms-search.ts)
//
// Jenis pencarian DITENTUKAN SERVER dari isi teks (lib/oms-search-query.ts), tidak diterima dari
// client:
//   - nomor invoice / resi (boleh sampai 20 sekaligus) → sesi OMS apa pun (admin & staff)
//   - nomor HP pembeli / nama pembeli                  → HANYA peran 'admin' (403 untuk staff)
//
// ── Kenapa nama & HP dibatasi, padahal staff sudah bisa melihat nama di daftar pesanan ──
// Melihat nama di baris pesanan yang sedang dikerjakan berbeda dari MENCARI orang lewat namanya:
// yang kedua bisa dipakai menelusuri riwayat belanja seseorang. Keputusan pemilik proyek 2026-09-17.
//
// ── Yang sengaja TIDAK dilakukan ──
// Teks pencarian tidak pernah ditulis ke log: isinya bisa nama atau nomor HP pembeli.

import { NextResponse, type NextRequest } from 'next/server'
import { getAdminIdentity, requireAdmin } from '@/lib/oms-guard'
import { parseOmsSearchQuery } from '@/lib/oms-search-query'
import {
  OMS_SEARCH_RESULT_LIMIT,
  searchOrdersByCustomerName,
  searchOrdersByInvoiceOrTracking,
  searchOrdersByPhone,
} from '@/lib/mock-db/orders'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { OmsSearchResponse, OmsSearchResult } from '@/types/oms-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin()
  if (unauthorized) return unauthorized

  const query = parseOmsSearchQuery(request.nextUrl.searchParams.get('q') ?? '')
  if (query.kind === 'invalid') {
    return NextResponse.json({ error: query.message, code: 'INVALID_QUERY' }, { status: 400 })
  }

  // Peran dibaca ulang dari DB (bukan dari cookie) — pola sama dengan requireAdminRole. Satu kali
  // baca dipakai untuk guard peran DAN kunci pembatas laju.
  const identity = await getAdminIdentity()
  if (!identity) {
    return NextResponse.json(
      { error: 'Tidak terautentikasi. Silakan login sebagai admin OMS.' },
      { status: 401 },
    )
  }

  // Guard peran dijalankan SEBELUM pembatas laju: staff yang mencoba mencari nama tak perlu
  // menghabiskan jatahnya untuk permintaan yang pasti ditolak.
  if ((query.kind === 'phone' || query.kind === 'name') && identity.role !== 'admin') {
    return NextResponse.json(
      {
        error:
          'Pencarian lewat nama atau nomor HP pembeli hanya untuk akun admin. Cari lewat nomor pesanan atau resi.',
        code: 'FORBIDDEN_ROLE',
      },
      { status: 403 },
    )
  }

  const limited = enforceRateLimit(`oms-search:admin:${identity.id}`, RATE_LIMITS.OMS_SEARCH_ADMIN)
  if (limited) return limited

  // === Nomor invoice / resi ===
  if (query.kind === 'orders') {
    const { byInvoice, byTracking } = await searchOrdersByInvoiceOrTracking(query.tokens)
    const results: OmsSearchResult[] = [
      ...byInvoice.map((r) => ({ ...r, matchedBy: 'invoice' as const })),
      ...byTracking.map((r) => ({ ...r, matchedBy: 'resi' as const })),
    ]

    // Urutan hasil mengikuti urutan nomor yang ditempel admin, bukan urutan database — daftar
    // serah terima dibaca dari atas ke bawah, dan hasil yang melompat-lompat membuatnya dicocokkan ulang.
    const position = (r: OmsSearchResult) => {
      const key = (r.matchedBy === 'invoice' ? r.orderId : (r.trackingNumber ?? '')).toUpperCase()
      const i = query.tokens.findIndex((t) => t.toUpperCase() === key)
      return i === -1 ? query.tokens.length : i
    }
    results.sort((a, b) => position(a) - position(b))

    const found = new Set(
      results.flatMap((r) => [r.orderId.toUpperCase(), (r.trackingNumber ?? '').toUpperCase()]),
    )
    const notFound = query.tokens.filter((t) => !found.has(t.toUpperCase()))

    const body: OmsSearchResponse = { mode: 'orders', results, notFound, truncated: false }
    return NextResponse.json(body)
  }

  // === Nomor HP / nama (admin saja — sudah dijaga di atas) ===
  const rows =
    query.kind === 'phone'
      ? await searchOrdersByPhone(query.phone)
      : await searchOrdersByCustomerName(query.name)
  const truncated = rows.length > OMS_SEARCH_RESULT_LIMIT
  const body: OmsSearchResponse = {
    mode: query.kind,
    results: rows
      .slice(0, OMS_SEARCH_RESULT_LIMIT)
      .map((r) => ({ ...r, matchedBy: query.kind })),
    notFound: [],
    truncated,
  }
  return NextResponse.json(body)
}
