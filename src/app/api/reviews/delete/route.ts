// src/app/api/reviews/delete/route.ts
// API menghapus ULASAN INTERNAL dari OMS (satuan maupun massal).
//
// Dipakai untuk membersihkan ulasan pengisi katalog setelah ulasan pembeli sungguhan berdatangan.
// ADMIN ONLY, dan hanya menyentuh baris ber-source='internal' — batas itu ditegakkan di query
// (deleteInternalReviews), bukan di layar. Ulasan pembeli tidak punya jalur hapus sama sekali:
// yang tersedia untuknya hanya sembunyikan (visible=false) lewat /api/reviews/visibility, supaya
// moderasi tak pernah menghilangkan jejak ulasan yang benar-benar dikirim orang.

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdminRole } from '@/lib/oms-guard'
import { deleteInternalReviews } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Jaring pengaman terhadap payload sampah / salah klik massal — sejajar /api/products/bulk.
const MAX_IDS = 200

export async function POST(request: Request) {
  const forbidden = await requireAdminRole('Hanya admin yang boleh menghapus ulasan internal.')
  if (forbidden) return forbidden

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Tidak ada ulasan yang dipilih.' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_IDS} ulasan sekali hapus.` },
      { status: 400 },
    )
  }

  const deleted = await deleteInternalReviews(ids)

  // `deleted` bisa lebih kecil dari jumlah id: id ulasan pembeli yang ikut terkirim memang
  // dilewati query. Angkanya dikembalikan apa adanya supaya OMS bisa mengatakan yang sebenarnya.
  revalidateTag('reviews', 'max')

  return NextResponse.json({ deleted })
}
