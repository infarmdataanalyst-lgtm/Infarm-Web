// src/lib/analytics-server.ts
// Mengirim event `purchase` dan `refund` ke Google Analytics 4 dari SISI SERVER lewat
// Measurement Protocol. `refund` dikirim saat dana pesanan SUDAH dikembalikan (lib/ga-refund.ts),
// dengan transaction_id yang sama dengan purchase-nya supaya revenue GA4 berkurang.
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
// ── Kenapa `session_id` ikut dikirim ──
// `client_id` saja menjawab "siapa yang membeli", bukan "dari kunjungan mana". Informasi sumber
// trafik (Direct, Referral, Organic Search, kampanye) melekat pada SESI. Tanpa session_id, GA4
// menerima penjualannya tapi tak punya sesi untuk menempelkannya.
//
// Akibatnya terukur di produksi 24 Sep 2026: laporan Akuisisi traffic menaruh SELURUH Rp83.888
// dari INV-20260923-R60NTSBP di baris "Unassigned", sementara semua kanal nyata berisi Rp0. Bukan
// "(direct)" seperti dugaan awal — benar-benar tak teratribusi.
//
// Penempelan ini bisa diandalkan di sini karena tagihan Xendit hanya berlaku 24 jam
// (SESSION_DURATION_SECONDS di lib/xendit/session.ts), jadi jarak terjauh antara sesi dan pembayaran adalah satu hari.

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
        // Keduanya HILANG bila cookie sesi tak terbaca — payload tetap sah, hanya atribusi
        // kanalnya yang tak ada. Lihat catatan session_id di kepala berkas.
        session_id?: string
        engagement_time_msec?: string
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

  // Diambil dari pesanan, bukan dioper terpisah seperti clientId: session_id tak menentukan apakah
  // event boleh dikirim (purchase tanpa sesi tetap layak dicatat — pendapatannya nyata, hanya
  // kanalnya yang tak diketahui), jadi ia cukup jadi bagian data pesanan.
  const sessionId = order.gaSessionId?.trim()

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
          // Disisipkan hanya bila ada — mengirim `session_id: undefined` membuat JSON.stringify
          // membuangnya, tapi bentuk objeknya jadi berbeda antara ada dan tidak, dan itu yang
          // diuji. Lebih jelas begini.
          ...(sessionId
            ? {
                session_id: sessionId,
                // Wajib menyertainya bersama session_id: tanpa ini GA4 menerima event-nya tapi
                // tak menghitungnya sebagai bagian sesi, dan atribusinya gagal diam-diam.
                // Nilainya sengaja 1 milidetik — event ini lahir di server, tak ada waktu layar
                // sungguhan untuk dilaporkan, dan angka besar akan menggelembungkan metrik
                // engagement yang dibaca dari laporan lain.
                engagement_time_msec: '1',
              }
            : {}),
        },
      },
    ],
  }
}

export type RefundPayload = {
  client_id: string
  events: [
    {
      name: 'refund'
      params: {
        currency: 'IDR'
        transaction_id: string
        value: number
      }
    },
  ]
}

// Menyusun payload event `refund` untuk pesanan yang dananya SUDAH dikembalikan. Fungsi MURNI.
//
// ── Kenapa `value` = totalAmount, bukan refund_amount ──
// Setiap refund di sistem ini lahir dari pembatalan pesanan UTUH (markRefundNeeded), jadi yang
// dibatalkan adalah seluruh purchase-nya. refund_amount bisa lebih kecil karena biaya transfer
// dipotong (jalur manual OMS) — selisih itu biaya toko, bukan pendapatan. Memakainya akan
// meninggalkan sisa revenue di GA4 untuk pesanan yang sudah batal. Keputusan pemilik 2026-10-05.
//
// ── Kenapa tanpa `items` dan tanpa `session_id` ──
// GA4 menganggap refund TANPA items sebagai refund penuh atas transaction_id-nya. session_id
// sengaja tak dikirim: refund terjadi berhari-hari setelah sesi pembelian, dan menempelkannya ke
// sesi selama itu belum terbukti berperilaku benar. Akibatnya refund tampil di kanal "Unassigned"
// pada laporan Akuisisi — revenue per transaksi tetap berkurang (UNVERIFIED, lihat docs).
export function buildRefundPayload(order: Order, clientId: string): RefundPayload {
  return {
    client_id: clientId,
    events: [
      {
        name: 'refund',
        params: {
          currency: 'IDR',
          // SAMA PERSIS dengan purchase-nya (nomor invoice) — GA4 mencocokkan refund lewat nilai ini.
          transaction_id: order.orderId,
          value: order.totalAmount,
        },
      },
    ],
  }
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'no-client-id' | 'http-error' | 'network' }

// Alasan event GA4 TIDAK boleh dikirim untuk pesanan ini, atau null bila boleh. Dipakai pemanggil
// refund untuk memutuskan SEBELUM mengklaim ga_refund_sent_at — klaim tanpa pengiriman akan
// membuat pesanan itu tampak sudah dilaporkan padahal belum.
export function gaSkipReason(order: Order): 'not-configured' | 'no-client-id' | null {
  if (!mpConfig()) return 'not-configured'
  if (!order.gaClientId?.trim()) return 'no-client-id'
  return null
}

// Kirim event `purchase` ke GA4. TIDAK PERNAH melempar: pembayaran sudah sah dan sudah tercatat di
// DB, jadi tak ada kegagalan di file ini yang boleh mengubah balasan ke Xendit.
export async function sendPurchaseEvent(
  order: Order,
  metaByProduct: Map<string, ProductMeta>,
  log: string,
): Promise<SendResult> {
  const clientId = readyClientId(order, 'purchase', log)
  if (typeof clientId !== 'string') return clientId

  const result = await postToMeasurementProtocol(
    buildPurchasePayload(order, clientId, metaByProduct),
    'purchase',
    order.orderId,
    log,
  )
  if (result.ok) {
    // Keadaan sesi ikut dicatat: inilah pembeda antara penjualan yang teratribusi ke kanal dan
    // yang mendarat di "Unassigned". Tanpa penanda ini, satu-satunya cara mengetahuinya adalah
    // menunggu 24-48 jam sampai laporan Akuisisi traffic terisi.
    const sesi = order.gaSessionId?.trim() ? 'dengan sesi' : 'TANPA sesi (akan Unassigned)'
    console.log(
      `${log} GA4 purchase terkirim: ${order.orderId} value=${order.totalAmount} ${sesi}`,
    )
  }
  return result
}

// Kirim event `refund` ke GA4. TIDAK PERNAH melempar: dananya sudah kembali dan sudah tercatat,
// jadi kegagalan di sini tak boleh menggagalkan penutupan refund maupun balasan webhook.
//
// Penjaga "satu event per pesanan" BUKAN di sini — lihat reportRefundToGa (lib/ga-refund.ts).
export async function sendRefundEvent(order: Order, log: string): Promise<SendResult> {
  const clientId = readyClientId(order, 'refund', log)
  if (typeof clientId !== 'string') return clientId

  const result = await postToMeasurementProtocol(
    buildRefundPayload(order, clientId),
    'refund',
    order.orderId,
    log,
  )
  if (result.ok) {
    console.log(`${log} GA4 refund terkirim: ${order.orderId} value=${order.totalAmount}`)
  }
  return result
}

// === Pengiriman bersama (purchase & refund) ===

function mpConfig(): { measurementId: string; apiSecret: string } | null {
  const measurementId = process.env.NEXT_PUBLIC_GA_ID?.trim()
  const apiSecret = process.env.GA_API_SECRET?.trim()
  return measurementId && apiSecret ? { measurementId, apiSecret } : null
}

// client_id pesanan bila event boleh dikirim; selain itu hasil gagal yang sudah dicatat di log.
function readyClientId(order: Order, eventName: string, log: string): string | SendResult {
  if (!mpConfig()) {
    // Bukan kesalahan yang perlu diteriakkan tiap pesanan: di lokal & preview env ini memang
    // sengaja kosong. Dicatat sekali per pesanan pada level info supaya tetap bisa ditelusuri
    // kalau produksi ternyata juga sunyi.
    console.log(`${log} GA4 ${eventName} dilewati: NEXT_PUBLIC_GA_ID / GA_API_SECRET belum di-set`)
    return { ok: false, reason: 'not-configured' }
  }

  const clientId = order.gaClientId?.trim()
  if (!clientId) {
    // Pembeli memblokir GA, memakai mode privat, atau pesanannya dibuat oleh klien versi lama.
    // Normal — jangan kirim dengan client_id karangan: GA4 menerimanya tanpa mengeluh lalu
    // mencatatnya sebagai pengunjung yang tak pernah ada. Untuk refund alasannya lebih kuat lagi:
    // tanpa client_id purchase-nya pun tak pernah terkirim, jadi refund akan mengurangi revenue
    // transaksi yang tak pernah ada di GA4.
    console.log(`${log} GA4 ${eventName} dilewati: pesanan ${order.orderId} tanpa ga_client_id`)
    return { ok: false, reason: 'no-client-id' }
  }
  return clientId
}

async function postToMeasurementProtocol(
  payload: PurchasePayload | RefundPayload,
  eventName: string,
  orderId: string,
  log: string,
): Promise<SendResult> {
  const config = mpConfig()
  if (!config) return { ok: false, reason: 'not-configured' }

  // URL memuat api_secret — JANGAN pernah dicatat ke log.
  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(config.apiSecret)}`

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
      console.error(`${log} GA4 ${eventName} ${orderId} ditolak HTTP ${res.status}`)
      return { ok: false, reason: 'http-error' }
    }
    return { ok: true }
  } catch (e) {
    // Hanya `name`: pesan galat fetch di sebagian runtime memuat URL — yang di sini berisi api_secret.
    console.error(
      `${log} GA4 ${eventName} ${orderId} gagal terkirim: ${e instanceof Error ? e.name : 'unknown'}`,
    )
    return { ok: false, reason: 'network' }
  }
}
