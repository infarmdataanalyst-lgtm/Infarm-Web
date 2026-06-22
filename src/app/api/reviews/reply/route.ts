// src/app/api/reviews/reply/route.ts
// API menyimpan/menghapus balasan admin pada sebuah ulasan (moderasi OMS).

import { NextResponse } from 'next/server'
import { setReviewReply } from '@/lib/mock-db/reviews'

export const runtime = 'nodejs'

// Menyimpan balasan admin. reply kosong/null = hapus balasan.
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 })
  }

  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id ulasan wajib ada.' }, { status: 400 })
  }

  // Normalisasi: string kosong dianggap menghapus balasan
  const reply =
    typeof body.reply === 'string' && body.reply.trim().length > 0 ? body.reply.trim() : null

  const ok = await setReviewReply(body.id, reply)
  if (!ok) {
    return NextResponse.json({ error: 'Gagal menyimpan balasan.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
