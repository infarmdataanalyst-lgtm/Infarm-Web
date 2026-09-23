// src/lib/analytics-server.ts
// Mengirim event `purchase` ke Google Analytics 4 dari SISI SERVER lewat Measurement Protocol.
//
// ── Kenapa dari server, bukan dari halaman sukses ──
// Pembayaran di sini asinkron. Pembeli dibawa ke halaman Xendit, dan VA/QRIS bisa dibayar
// berjam-jam kemudian — banyak yang tak pernah kembali ke /checkout/success sama sekali. Event di
// halaman sukses berarti: penjualan yang paling lambat dibayar hilang dari laporan, dan pembeli
// yang me-refresh halaman dihitung dua kali. Keduanya tak bisa dikoreksi setelah terkirim.
//
// Webhook Xendit adalah SATU-SATUNYA titik yang tahu pembayaran benar-benar masuk, jadi di sanalah
// event ini lahir.
//
// ── Idempotensi ──
// Xendit mengulang kirim callback yang sama. Penjaganya bukan di file ini melainkan di
// handlePaid(): event hanya dikirim setelah status BERHASIL berpindah Menunggu → Lunas, dan
// callback kedua berhenti lebih dulu di cabang ALREADY_PAID. `transaction_id` (nomor invoice)
// dikirim sebagai lapis kedua — GA4 memakainya untuk membuang purchase kembar.
//
// ── Batas yang diketahui ──
// Hanya `client_id` yang dititipkan, bukan `session_id`. Akibatnya event ini tidak bergabung ke
// sesi browsing pembeli, dan "Session source" untuk sesi server-nya akan terbaca (direct).
// Atribusi tingkat PENGGUNA tetap berjalan — GA4 menghubungkan purchase ini dengan sesi-sesi
// sebelumnya milik client_id yang sama, jadi laporan akuisisi & konversi tetap mengkredit kanal
// yang benar. Menitipkan session_id butuh membaca cookie `_ga_<measurement-id>` yang bentuknya
// tidak didokumentasikan sama sekali; sengaja tidak dikerjakan bersamaan dengan pipa ini.

import 'server-only'

import type { Order } from '@/types/order'

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect'

// Webhook Xendit punya anggaran waktunya sendiri dan pembayaran TIDAK boleh tertahan karena
// Google lambat. Lebih pendek dari timeout Mengantar (8–12 dtk) karena kegagalannya jauh lebih
// murah: satu baris laporan, bukan satu paket yang tak dijemput.
const MP_TIMEOUT_MS = 4_000

// Satu item dalam payload GA4.
type GaItem = {
  item_id: string
  item_name: string
  item_category: string
  price: number
  quantity: number
}

export type PurchasePayload = {
  client_id: string
  events: [
    {
      name: 'purchase'
      params: {
        currency: 'IDR'
        transaction_id: string
        value: number
        shipping: number
        items: GaItem[]
      }
    },
  ]
}

// Detail produk yang dibutuhkan payload tapi TIDAK tersimpan di order_items.
export type ProductMeta = { sku?: string; category?: string }

// Menyusun payload Measurement Protocol dari pesanan yang sudah lunas. Fungsi MURNI — tak
// menyentuh jaringan, env, atau database — supaya bentuk payloadnya bisa diuji.
//
// `metaByProduct` memasok SKU & kategori, yang tak ada di order_items. SKU-nya penting: halaman
// detail produk mengirim `sku || id` sebagai item_id, jadi purchase HARUS memakai aturan yang sama
// atau GA4 memperlakukan barang yang sama sebagai dua item berbeda dan funnel terputus di langkah
// terakhir — tepat di langkah yang paling mahal untuk hilang.
export function buildPurchasePayload(
  order: Order,
  clientId: string,
  metaByProduct: Map<string, ProductMeta>,
): PurchasePayload {
  const items: GaItem[] = order.items.map((item) => {
    const meta = metaByProduct.get(item.productId)
    return {
      item_id: meta?.sku || item.productId,
      item_name: item.name,
      item_category: meta?.category ?? '',
      price: item.price,
      quantity: item.quantity,
    }
  })

  return {
    client_id: clientId,
    events: [
      {
        name: 'purchase',
        params: {
          currency: 'IDR',
          // Nomor invoice, bukan id_transaksi Xendit: inilah nomor yang muncul di OMS dan di
          // laporan penjualan, jadi angka GA4 bisa dicocokkan baris per baris dengan database.
          transaction_id: order.orderId,
          // Total yang benar-benar dibayar — sudah termasuk ongkir, sudah dikurangi diskon &
          // subsidi ongkir. Inilah yang seharusnya sama dengan uang masuk di Xendit.
          value: order.totalAmount,
          shipping: order.shippingCost ?? 0,
          items,
        },
      },
    ],
  }
}

type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'no-client-id' | 'http-error' | 'network' }

// Kirim payload ke GA4. TIDAK PERNAH melempar: pembayaran sudah sah dan sudah tercatat di DB,
// jadi tak ada kegagalan di file ini yang boleh mengubah balasan ke Xendit.
export async function sendPurchaseEvent(
  order: Order,
  metaByProduct: Map<string, ProductMeta>,
  log: string,
): Promise<SendResult> {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID?.trim()
  const apiSecret = process.env.GA_API_SECRET?.trim()

  if (!measurementId || !apiSecret) {
    // Bukan kesalahan yang perlu diteriakkan tiap pesanan: di lokal & preview env ini memang
    // sengaja kosong. Dicatat sekali per pesanan pada level info supaya tetap bisa ditelusuri
    // kalau produksi ternyata juga sunyi.
    console.log(`${log} GA4 purchase dilewati: NEXT_PUBLIC_GA_ID / GA_API_SECRET belum di-set`)
    return { ok: false, reason: 'not-configured' }
  }

  const clientId = order.gaClientId?.trim()
  if (!clientId) {
    // Pembeli memblokir GA, memakai mode privat, atau pesanannya dibuat oleh klien versi lama.
    // Normal — jangan kirim dengan client_id karangan: GA4 menerimanya tanpa mengeluh lalu
    // mencatatnya sebagai pengunjung yang tak pernah ada.
    console.log(`${log} GA4 purchase dilewati: pesanan ${order.orderId} tanpa ga_client_id`)
    return { ok: false, reason: 'no-client-id' }
  }

  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`
  const payload = buildPurchasePayload(order, clientId, metaByProduct)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    })

    // ⚠️ Measurement Protocol SELALU membalas 204 tanpa badan, bahkan untuk payload yang ditolak
    // diam-diam. Status 2xx di sini berarti "Google menerima permintaannya", BUKAN "event tercatat
    // dengan benar". Satu-satunya cara memverifikasi bentuk payload adalah endpoint debug
    // (/debug/mp/collect), yang sengaja tidak dipakai di jalur produksi ini.
    if (!res.ok) {
      console.error(`${log} GA4 purchase ${order.orderId} ditolak HTTP ${res.status}`)
      return { ok: false, reason: 'http-error' }
    }

    console.log(`${log} GA4 purchase terkirim: ${order.orderId} value=${order.totalAmount}`)
    return { ok: true }
  } catch (e) {
    console.error(
      `${log} GA4 purchase ${order.orderId} gagal terkirim:`,
      e instanceof Error ? e.message : e,
    )
    return { ok: false, reason: 'network' }
  }
}
