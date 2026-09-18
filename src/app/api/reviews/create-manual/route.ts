// src/app/api/reviews/create-manual/route.ts
// API menambahkan ULASAN INTERNAL dari OMS — ulasan yang dimasukkan admin, bukan dari pembeli
// (mis. testimoni dari marketplace lain, hasil uji produk internal untuk mengisi katalog baru).
//
// ── Kenapa admin saja, bukan setiap sesi OMS ──
// Endpoint ini menulis ke halaman produk publik atas nama orang yang tidak pernah memesan, dan ikut
// menggeser rata-rata rating produk. Itu wewenang pemilik toko, bukan operasional harian — jadi
// requireAdminRole, sejajar dengan endpoint simpan produk.
//
// Ulasan yang masuk lewat sini SELALU source='internal' dan order_invoice NULL. Penandanya tak bisa
// dipilih dari body: kalau ia bisa dikirim client, satu payload salah ketik cukup untuk membuat
// ulasan internal menyamar jadi ulasan pembeli secara permanen.

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdminRole } from '@/lib/oms-guard'
import { createManualReview } from '@/lib/mock-db/reviews'
import {
  REVIEW_AUTHOR_NAME_MAX,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_TOO_LONG,
} from '@/lib/review-validation'

export const runtime = 'nodejs'

// Panjang maksimal kategori — sejajar dengan yang dipakai endpoint ulasan pembeli.
const CATEGORY_MAX = 50

export async function POST(request: Request) {
  const forbidden = await requireAdminRole('Hanya admin yang boleh menambah ulasan internal.')
  if (forbidden) return forbidden

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  if (!productId) {
    return NextResponse.json({ error: 'Produk wajib dipilih.' }, { status: 400 })
  }

  const authorName = typeof body.authorName === 'string' ? body.authorName.trim() : ''
  if (authorName.length < 2) {
    return NextResponse.json({ error: 'Nama penulis minimal 2 karakter.' }, { status: 400 })
  }
  if (authorName.length > REVIEW_AUTHOR_NAME_MAX) {
    return NextResponse.json(
      { error: `Nama penulis maksimal ${REVIEW_AUTHOR_NAME_MAX} karakter.` },
      { status: 400 },
    )
  }

  const rating = typeof body.rating === 'number' ? Math.floor(body.rating) : NaN
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating harus 1–5.' }, { status: 400 })
  }

  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (comment.length < 3) {
    return NextResponse.json({ error: 'Komentar minimal 3 karakter.' }, { status: 400 })
  }
  if (comment.length > REVIEW_COMMENT_MAX) {
    return NextResponse.json({ error: REVIEW_COMMENT_TOO_LONG }, { status: 400 })
  }

  const category =
    typeof body.category === 'string' && body.category.trim()
      ? body.category.trim().slice(0, CATEGORY_MAX)
      : undefined

  // Tanggal boleh mundur (menyalin testimoni lama), tapi TIDAK boleh maju: ulasan bertanggal besok
  // tampil sebagai "dalam 1 hari" di storefront dan terbaca seperti data rusak.
  let createdAt: string | undefined
  if (typeof body.createdAt === 'string' && body.createdAt.trim()) {
    const waktu = new Date(body.createdAt)
    if (Number.isNaN(waktu.getTime())) {
      return NextResponse.json({ error: 'Tanggal tidak valid.' }, { status: 400 })
    }
    if (waktu.getTime() > Date.now()) {
      return NextResponse.json({ error: 'Tanggal ulasan tidak boleh di masa depan.' }, { status: 400 })
    }
    createdAt = waktu.toISOString()
  }

  try {
    const id = await createManualReview({ productId, authorName, rating, comment, category, createdAt })

    // Halaman detail produk + ringkasan rating ikut berubah begitu ulasan masuk.
    revalidateTag('reviews', 'max')
    revalidatePath(`/produk/${productId}`)

    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    const pesan = err instanceof Error ? err.message : 'Gagal menyimpan ulasan internal.'
    return NextResponse.json({ error: pesan }, { status: 500 })
  }
}
