// src/lib/meta-capi.ts
// Mengirim event `Purchase` ke Meta (Facebook/Instagram Ads) dari SISI SERVER lewat Conversions
// API — padanan lib/analytics-server.ts untuk GA4, dengan alasan yang sama: pembayaran Xendit
// asinkron, dan webhook adalah satu-satunya titik yang tahu uangnya benar-benar masuk.
//
// ── Deduplikasi ──
// `event_id` = nomor invoice. Kalau suatu hari browser juga mengirim Purchase (lib/meta-pixel.ts
// sengaja TIDAK melakukannya), Meta membuang kembarannya selama event_id sama. Pengulangan
// callback Xendit sudah ditahan di handlePaid (cabang ALREADY_PAID), jadi baris ini hanya
// tercapai sekali per pesanan — event_id lapis keduanya.
//
// ── Data pembeli (email & telepon) ──
// Dikirim sebagai hash SHA-256 setelah dinormalisasi, sesuai aturan Meta — teks aslinya tak pernah
// meninggalkan server. Tanpa ini Meta hanya punya cookie `_fbp/_fbc` untuk mencocokkan pembeli,
// dan pencocokan lewat cookie saja makin sering gagal (iOS, pemblokir). Email+telepon yang
// di-hash menaikkan Event Match Quality, dan itulah yang menentukan berapa banyak pembelian yang
// benar-benar teratribusi ke iklan.
//
// ── Token ──
// `META_CAPI_TOKEN` dikirim di BADAN permintaan, bukan di URL, supaya tak pernah ikut tercatat di
// log galat yang memuat URL. Badan permintaan tidak pernah dicatat.

import 'server-only'

import { createHash } from 'node:crypto'
import type { Order } from '@/types/order'
import type { ProductMeta } from '@/lib/analytics-server'

const GRAPH_VERSION = 'v21.0'
// Sama dengan GA4 (MP_TIMEOUT_MS): webhook Xendit tak boleh tertahan karena Meta lambat.
const CAPI_TIMEOUT_MS = 4_000

// === Normalisasi & hash (aturan Meta) ===

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

// Email: huruf kecil, tanpa spasi. undefined bila jelas bukan email — Meta mencocokkan hash
// persis, jadi hash dari teks sembarang hanya menurunkan skor tanpa pernah cocok.
export function normalizeEmail(raw: string | undefined): string | undefined {
  const v = raw?.trim().toLowerCase()
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined
}

// Telepon: hanya digit, dengan kode negara, tanpa '+' — format yang diminta Meta. Nomor Indonesia
// ditulis pembeli sebagai 08xx; '0' depan diganti '62'. Nomor yang sudah 62xx dibiarkan.
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) digits = `62${digits}`
  return /^\d{10,15}$/.test(digits) ? digits : undefined
}

// === Payload ===

type MetaContent = { id: string; quantity: number; item_price: number }

export type MetaPurchasePayload = {
  data: [
    {
      event_name: 'Purchase'
      event_time: number // unix DETIK
      event_id: string
      action_source: 'website'
      event_source_url?: string
      user_data: { em?: string[]; ph?: string[]; fbp?: string; fbc?: string }
      custom_data: {
        currency: 'IDR'
        value: number
        content_type: 'product'
        content_ids: string[]
        contents: MetaContent[]
        num_items: number
        order_id: string
      }
    },
  ]
  // Dari Events Manager → Test Events. Bila diisi, event muncul di tab itu dan TIDAK dihitung
  // sebagai data iklan sungguhan — dipakai saat uji sandbox.
  test_event_code?: string
}

// Alasan event TIDAK bisa dikirim untuk pesanan ini. 'no-user-data' = tak ada satu pun pengenal
// pembeli (cookie, email, telepon) — Meta menolak event web tanpa user_data, dan mengirimnya pun
// tak berguna: tak ada yang bisa dicocokkan.
export type MetaSkipReason = 'not-configured' | 'no-user-data'

// Menyusun payload Conversions API. Fungsi MURNI (tanpa env/jaringan) supaya bentuknya bisa
// diuji. null bila tak ada pengenal pembeli sama sekali.
export function buildMetaPurchasePayload(
  order: Order,
  metaByProduct: Map<string, ProductMeta>,
  eventTimeSec: number,
  options: { sourceUrl?: string; testEventCode?: string } = {},
): MetaPurchasePayload | null {
  const em = normalizeEmail(order.customerEmail)
  const ph = normalizePhone(order.customerPhone)
  const fbp = order.metaFbp?.trim() || undefined
  const fbc = order.metaFbc?.trim() || undefined
  if (!em && !ph && !fbp && !fbc) return null

  // item id mengikuti aturan yang sama dengan GA4 & pixel browser (`sku || id`), supaya
  // ViewContent → Purchase di Meta bicara tentang barang yang sama.
  const contents: MetaContent[] = order.items.map((item) => ({
    id: metaByProduct.get(item.productId)?.sku || item.productId,
    quantity: item.quantity,
    item_price: item.price,
  }))

  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: eventTimeSec,
        event_id: order.orderId,
        action_source: 'website',
        ...(options.sourceUrl ? { event_source_url: options.sourceUrl } : {}),
        user_data: {
          ...(em ? { em: [sha256(em)] } : {}),
          ...(ph ? { ph: [sha256(ph)] } : {}),
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
        },
        custom_data: {
          currency: 'IDR',
          // Total yang benar-benar dibayar (termasuk ongkir, sudah dikurangi diskon) — sama
          // dengan `value` purchase GA4, supaya ROAS Meta dan laporan GA4 bicara angka yang sama.
          value: order.totalAmount,
          content_type: 'product',
          content_ids: contents.map((c) => c.id),
          contents,
          num_items: contents.reduce((sum, c) => sum + c.quantity, 0),
          order_id: order.orderId,
        },
      },
    ],
    ...(options.testEventCode ? { test_event_code: options.testEventCode } : {}),
  }
}

// === Pengiriman ===

export type MetaSendResult = { ok: true } | { ok: false; reason: MetaSkipReason | 'http-error' | 'network' }

function capiConfig(): { pixelId: string; token: string } | null {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()
  const token = process.env.META_CAPI_TOKEN?.trim()
  return pixelId && /^\d{5,20}$/.test(pixelId) && token ? { pixelId, token } : null
}

// Kirim `Purchase` ke Meta. TIDAK PERNAH melempar: pembayaran sudah sah dan tercatat di DB, jadi
// tak ada kegagalan di sini yang boleh mengubah balasan ke Xendit.
export async function sendMetaPurchase(
  order: Order,
  metaByProduct: Map<string, ProductMeta>,
  log: string,
): Promise<MetaSendResult> {
  const config = capiConfig()
  if (!config) {
    // Di lokal & preview memang kosong. Level info, sekali per pesanan — cukup untuk menyadari
    // kalau produksi ternyata juga sunyi.
    console.log(`${log} Meta Purchase dilewati: NEXT_PUBLIC_META_PIXEL_ID / META_CAPI_TOKEN belum di-set`)
    return { ok: false, reason: 'not-configured' }
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  const payload = buildMetaPurchasePayload(order, metaByProduct, Math.floor(Date.now() / 1000), {
    sourceUrl: site ? `${site}/checkout` : undefined,
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined,
  })
  if (!payload) {
    console.log(`${log} Meta Purchase dilewati: pesanan ${order.orderId} tanpa pengenal pembeli`)
    return { ok: false, reason: 'no-user-data' }
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.pixelId}/events`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Token di badan, bukan URL — lihat catatan di kepala berkas.
      body: JSON.stringify({ ...payload, access_token: config.token }),
      signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
    })

    if (!res.ok) {
      // Graph API membalas JSON { error: { message, code } } — pesannya aman dicatat (tak memuat
      // token), dan itulah satu-satunya petunjuk bila payload ditolak.
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: number } }
        detail = body.error ? ` ${body.error.code ?? ''} ${body.error.message ?? ''}`.trimEnd() : ''
      } catch {
        // badan bukan JSON — cukup status
      }
      console.error(`${log} Meta Purchase ${order.orderId} ditolak HTTP ${res.status}${detail}`)
      return { ok: false, reason: 'http-error' }
    }

    const pengenal = [
      payload.data[0].user_data.em ? 'email' : null,
      payload.data[0].user_data.ph ? 'telepon' : null,
      payload.data[0].user_data.fbp ? 'fbp' : null,
      payload.data[0].user_data.fbc ? 'fbc (dari iklan)' : null,
    ]
      .filter(Boolean)
      .join(', ')
    console.log(`${log} Meta Purchase terkirim: ${order.orderId} value=${order.totalAmount} pengenal=${pengenal}`)
    return { ok: true }
  } catch (e) {
    console.error(`${log} Meta Purchase ${order.orderId} gagal terkirim: ${e instanceof Error ? e.name : 'unknown'}`)
    return { ok: false, reason: 'network' }
  }
}
