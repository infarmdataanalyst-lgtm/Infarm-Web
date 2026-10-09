// src/app/api/email/check-domain/route.ts
// POST { email } → { ok: boolean, message?: string }
// Dipanggil form checkout saat field email kehilangan fokus, untuk menampilkan pesan kecil di bawah
// field bila DOMAIN email-nya tak bisa menerima surat (lihat lib/email-domain.ts).
//
// Ini hanya UX. Penegakannya ada di /api/orders/create, yang memeriksa ulang dengan fungsi yang
// sama — endpoint ini boleh dilewati siapa pun tanpa membuka celah.
//
// `ok: false` HANYA untuk jawaban DNS yang pasti. Galat, timeout, rate limit, maupun format yang
// salah (sudah ditangani validasi format di client) → `ok: true`, supaya pesan ini tak pernah
// menghalangi pembeli asli.

import { NextResponse } from 'next/server'
import { checkEmailDomain } from '@/lib/email-domain'
import { EMAIL_DOMAIN_NOT_FOUND_MESSAGE, isValidEmail, normalizeEmail } from '@/lib/email'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const limited = enforceRateLimit(
    `email-domain-check:ip:${getClientIp(request)}`,
    RATE_LIMITS.EMAIL_DOMAIN_CHECK_IP,
  )
  if (limited) return limited

  let email = ''
  try {
    const body = (await request.json()) as { email?: unknown }
    email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  } catch {
    return NextResponse.json({ ok: true })
  }
  if (!isValidEmail(email)) return NextResponse.json({ ok: true })

  const status = await checkEmailDomain(email)
  if (status === 'no-mail') {
    return NextResponse.json({ ok: false, message: EMAIL_DOMAIN_NOT_FOUND_MESSAGE })
  }
  return NextResponse.json({ ok: true })
}
