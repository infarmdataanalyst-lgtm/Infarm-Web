// src/app/dev/email-preview/route.ts
// Preview developer untuk template email konfirmasi pesanan.
// Membaca src/emails/order-confirmation.html lalu mengisi placeholder dengan data contoh,
// agar bisa dilihat di browser (http://localhost:3000/dev/email-preview) seperti email asli.
// Hanya untuk preview lokal — bukan bagian alur pengiriman email produksi.
//
// ── Kenapa ada gate NODE_ENV (SEC-027) ──
// Route ini dulu tak punya gate sama sekali, jadi ikut hidup di produksi. Dampaknya kecil tapi
// nyata: markup template bocor ke publik, dan tiap permintaan memicu readFile di fungsi
// serverless. Polanya menyalin src/app/api/dev/simulate-payment — notFound(), bukan 403, supaya dari
// luar route ini tak bisa dibedakan dari path yang memang tak ada.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { notFound } from 'next/navigation'
import { NextResponse } from 'next/server'
import { renderEmailTemplate } from '@/lib/email-template'

// Butuh runtime Node.js (akses filesystem) & selalu baca file terbaru saat preview
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Data contoh untuk mengisi placeholder template (mirip data backend nantinya)
const SAMPLE: Record<string, string> = {
  order_id: 'INF-882910',
  total_price: 'Rp45.000',
  tracking_url: '/track',
  cancel_url: '#',
  // Preview membaca logo dari public/images/email/logo-infarm.png (taruh file logonya di sana).
  // Selama file belum ada, gambar akan tampil "broken"/alt "Infarm" — itu normal.
  // Produksi: backend mengisi {{logo_url}} dengan URL absolut (https://...).
  logo_url: '/images/email/logo-infarm.png',
  // {{item_list}} di-render backend jadi baris produk; ini contoh satu baris.
  item_list:
    '<tr><td style="padding:8px 0; color:#3A3A3A;">1&times; Pupuk Nutrisi Cair</td>' +
    '<td align="right" style="padding:8px 0; color:#9A9A9A;">&ndash;</td></tr>',
}

// Placeholder yang isinya memang markup buatan kita sendiri, jadi TIDAK boleh di-escape.
// Daftar ini sengaja pendek dan eksplisit — menambah entri baru ke sini berarti menyatakan bahwa
// nilainya tak akan pernah dirangkai langsung dari input pelanggan.
const RAW_PLACEHOLDERS = ['item_list'] as const

// GET: kembalikan HTML template yang placeholder-nya sudah terisi data contoh.
export async function GET() {
  // Preview developer tak punya alasan hidup di luar mesin pengembang.
  if (process.env.NODE_ENV !== 'development') notFound()

  try {
    const filePath = path.join(process.cwd(), 'src', 'emails', 'order-confirmation.html')
    const template = await readFile(filePath, 'utf-8')
    const html = renderEmailTemplate(template, SAMPLE, RAW_PLACEHOLDERS)

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return new NextResponse('Gagal memuat template email.', { status: 500 })
  }
}
