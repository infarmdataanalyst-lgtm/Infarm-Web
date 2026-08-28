// tests/e2e/checkout-invalid-destination.spec.ts
// E2E (request API, TANPA browser): checkout dengan `destination_id` ngawur harus DITOLAK dengan
// pesan yang bisa dipahami — bukan 500, bukan crash, dan bukan pesanan hantu yang diam-diam
// tersimpan.
//
// ── Endpoint yang diuji ──
// `POST /api/orders/create` — Route Handler biasa, dipanggil lewat HTTP.
//
// Proyek ini TIDAK memakai Server Action sama sekali (nol berkas ber-`'use server'`); seluruh
// logika server berjalan lewat Route Handler di `src/app/api/**`. Jadi endpoint ini memang bisa —
// dan memang dirancang untuk — dipanggil langsung lewat HTTP: halaman checkout pun memanggilnya
// dengan `fetch` dari komponen klien (src/app/checkout/page.tsx). Tak ada lapisan RPC tersembunyi
// yang perlu ditiru di sini.
//
// ── Kenapa uji ini AMAN dijalankan berulang ──
// Jalur yang benar TIDAK membuat pesanan: server menolak sebelum menyentuh RPC
// `create_order_with_items`, jadi tak ada baris `orders`, tak ada stok terpotong, tak ada invoice
// Xendit, tak ada booking kurir.
//
// Kalau penolakan itu GAGAL terjadi, sebuah pesanan sungguhan akan tercipta. Uji ini karena itu
// ikut memeriksa tabel `orders` setelahnya dan melaporkan apa yang masuk — kegagalannya tak boleh
// hanya berupa "assertion merah", ia harus memberitahu apa yang tertinggal di database.
//
// ── Perilaku yang diharapkan ──
// `destination_id` karangan ditolak `422 DESTINATION_INVALID` oleh pemeriksaan BENTUK di awal
// route — id Mengantar selalu ObjectId 24 hex, jadi teks sembarang gugur tanpa menyentuh jaringan.
//
// Itu berbeda dari `422 DESTINATION_UNSERVICEABLE`, yang menangani id BERBENTUK BENAR tapi tak ada
// di indeks Mengantar. Penjaga kedua itu bergantung pada `warehousesResponded > 0`, dan justru di
// situ celahnya dulu: saat cek ongkir habis waktu, "tujuan ngawur" tak bisa dibedakan dari
// "Mengantar sedang down", lalu permintaannya diloloskan. Nyata terjadi — INV-20260827-PR6TP0T6
// tersimpan dengan destination_id "invalid-destination-xyz" dan stok terpotong 67 unit. Pemeriksaan
// bentuk menutupnya tanpa bergantung pada jaringan sama sekali.

import { readFileSync } from 'node:fs'
import { test, expect, type APIRequestContext } from '@playwright/test'

// Penanda unik supaya baris yang mungkin tercipta bisa ditemukan & dibersihkan.
// Bukan `Date.now()` di scope modul — cukup di dalam uji, sekali.
const NAMA_PENGUJI = 'E2E Invalid Destination'

// Tujuan yang dijamin tak pernah ada di indeks Mengantar. Formatnya sengaja BUKAN ObjectId 24 hex
// supaya jelas ini karangan, bukan id lama yang kebetulan sudah dihapus.
const DESTINATION_NGAWUR = 'invalid-destination-xyz'

// Status yang sah DI DATABASE.
//
// ⚠️ Ini nilai MENTAH kolomnya, bukan label yang tampil di OMS. Uji ini membaca tabel `orders`
// langsung lewat REST Supabase, jadi ia melewati `rowToOrder()` yang biasanya menerjemahkan:
//
//   order_status:      PENDING → 'Menunggu Pembayaran' · PROCESSING → 'Diproses'
//                      SHIPPED → 'Dikirim' · COMPLETED → 'Selesai' · CANCELLED → 'Dibatalkan'
//   status_pembayaran: PENDING → 'Menunggu' · PAID → 'Lunas' · FAILED → 'Gagal'
//
// Memakai label Indonesia di sini akan membuat assertion selalu merah pada baris yang sebenarnya
// sehat — diperiksa langsung ke DB dan memang berisi "PROCESSING"/"PAID".
const STATUS_FULFILLMENT_SAH = ['PENDING', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED']
const STATUS_PEMBAYARAN_SAH = ['PENDING', 'PAID', 'FAILED']

// Kredensial Supabase dibaca dari .env.local karena proses Playwright TIDAK mewarisi env dev
// server (`next dev` yang memuatnya, bukan runner uji). Pola sama dengan checkout-ongkir-flow.
function envLocal(key: string): string {
  try {
    const isi = readFileSync('.env.local', 'utf-8')
    const baris = isi.split('\n').find((l) => l.startsWith(`${key}=`))
    return baris ? baris.slice(key.length + 1).trim() : ''
  } catch {
    return ''
  }
}

type BarisOrder = {
  nomor_invoice: string | null
  order_status: string | null
  status_pembayaran: string | null
  destination_id: string | null
  jumlah_total: number | null
  created_at: string | null
}

// Mencari pesanan yang dibuat oleh uji ini (dikenali dari nama pembeli).
// Membaca saja — memakai service_role karena tabel `orders` dikunci dari publik oleh RLS.
// `sejak` = waktu tepat sebelum permintaan dikirim.
//
// WAJIB dibatasi waktu. Tanpa ini, satu pesanan sampah dari jalan sebelumnya membuat uji ini merah
// SELAMANYA — persis yang terjadi pada INV-20260827-PR6TP0T6: perbaikannya sudah benar dan tak ada
// baris baru tercipta, tapi residu lama tetap terhitung dan menuduh kode yang sudah sehat.
async function cariOrderUji(
  request: APIRequestContext,
  sejak: string,
): Promise<BarisOrder[] | null> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const key = envLocal('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null

  const kolom = 'nomor_invoice,order_status,status_pembayaran,destination_id,jumlah_total,created_at'
  const res = await request.get(
    `${url}/rest/v1/orders?select=${kolom}` +
      // Kolomnya `nama_customer` (bukan `nama_pelanggan`) — lihat rowToOrder di mock-db/orders.ts.
      `&nama_customer=eq.${encodeURIComponent(NAMA_PENGUJI)}` +
      `&created_at=gte.${encodeURIComponent(sejak)}` +
      `&order=created_at.desc&limit=5`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  )
  if (!res.ok()) return null
  return (await res.json()) as BarisOrder[]
}

test.describe('Checkout — destination_id tidak valid', () => {
  test('ditolak dengan pesan yang jelas, dan tak meninggalkan pesanan hantu', async ({
    request,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()

    // === Susun payload yang VALID di semua sisi kecuali destination_id ===
    //
    // Produk & harga diambil dari API, bukan dikarang: server mengabaikan harga dari client dan
    // menolak id produk yang tak dikenal (422). Payload dengan produk karangan akan gagal di
    // validasi produk — bukan di validasi tujuan — dan uji ini jadi menguji hal yang salah.
    const resProduk = await request.get(`${baseURL}/api/products/list`)
    expect(resProduk.ok(), 'GET /api/products/list harus berhasil').toBeTruthy()
    const { products = [] } = (await resProduk.json()) as {
      products?: {
        id: string
        name: string
        promoPrice: number
        stock?: number
        archived?: boolean
        minOrderQty?: number
      }[]
    }

    const produk = products.find((p) => !p.archived && (p.stock ?? 0) > 0 && p.promoPrice > 0)
    expect(produk, 'butuh minimal satu produk aktif & berstok untuk menyusun payload').toBeTruthy()

    // Kuantitas dinaikkan sampai memenuhi minimum belanja toko. Kalau tidak, server menolak dengan
    // 422 "Minimal belanja …" — penolakan yang benar, tapi bukan yang sedang diuji.
    const resMin = await request.get(`${baseURL}/api/settings/min-order`)
    const { minOrderAmount = 0 } = resMin.ok()
      ? ((await resMin.json()) as { minOrderAmount?: number })
      : {}

    const qtyMinProduk = produk!.minOrderQty ?? 1
    const qtyUntukMinBelanja = Math.ceil(minOrderAmount / produk!.promoPrice)
    const quantity = Math.max(1, qtyMinProduk, qtyUntukMinBelanja)

    const payload = {
      customerName: NAMA_PENGUJI,
      customerPhone: '081234567890', // 08xx, 12 digit — sah menurut src/lib/phone.ts
      items: [{ productId: produk!.id, name: produk!.name, quantity, price: produk!.promoPrice }],
      totalAmount: produk!.promoPrice * quantity,
      shippingCost: 10_000,
      logistics: { courier: 'J&T', service: 'Reguler' },
      weight: 1,
      address: {
        shippingAddress: 'Jl. Uji Otomatis No. 1',
        provinsi: 'Dki Jakarta',
        kota: 'Jakarta Pusat',
        kecamatan: 'Gambir',
        kelurahan: 'Gambir',
        kodepos: '10110',
        destinationId: DESTINATION_NGAWUR, // ← SATU-SATUNYA field yang sengaja salah
      },
    }

    // === Kirim ===
    // Penanda waktu diambil SEBELUM permintaan, dengan mundur 5 detik sebagai bantalan selisih jam
    // antara mesin ini dan server Supabase.
    const sejak = new Date(Date.now() - 5_000).toISOString()

    const res = await request.post(`${baseURL}/api/orders/create`, {
      data: payload,
      failOnStatusCode: false, // penolakan adalah hasil yang DIHARAPKAN, bukan kegagalan transport
      timeout: 60_000, // server memanggil Mengantar untuk memverifikasi tujuan
    })

    const status = res.status()
    const mentah = await res.text()
    let body: { error?: string; code?: string; invoice?: string } = {}
    try {
      body = JSON.parse(mentah)
    } catch {
      // dibiarkan kosong — dinilai di assertion di bawah
    }

    console.log(`\n  status  : ${status}`)
    console.log(`  body    : ${mentah.slice(0, 400)}`)

    // === Assert 1: tidak crash ===
    expect(
      status,
      `server membalas ${status} — kegagalan tak tertangani. Body: ${mentah.slice(0, 300)}`,
    ).toBeLessThan(500)

    // === Assert 2: jawabannya bisa dipahami ===
    // Yang dituntut: JSON yang bisa diurai, dengan pesan berbahasa manusia. Bukan body kosong,
    // bukan tumpukan stack trace, bukan 200 tanpa penjelasan.
    expect(
      body,
      `respons bukan JSON yang bisa diurai. Mentah: ${mentah.slice(0, 300)}`,
    ).toBeTruthy()

    expect(status, `tujuan ngawur harus ditolak sebagai kesalahan client (4xx), dapat ${status}`)
      .toBeGreaterThanOrEqual(400)

    expect(
      typeof body.error === 'string' && body.error.trim().length > 10,
      `pesan error tak memadai: ${JSON.stringify(body)}`,
    ).toBeTruthy()

    // Pesannya harus untuk PEMBELI, bukan bocoran teknis.
    expect(
      body.error,
      'pesan error membocorkan detail teknis — pembeli tak bisa berbuat apa-apa dengannya',
    ).not.toMatch(/stack|undefined|null|TypeError|ECONNREFUSED|supabase|postgres/i)

    console.log(`  code    : ${body.code ?? '(tak ada)'}`)
    console.log(`  pesan   : ${body.error}`)

    // === Assert 3: tak ada pesanan yang tertinggal ===
    const baris = await cariOrderUji(request, sejak)

    if (baris === null) {
      console.log(
        '\n  ⚠ Tabel orders TIDAK diperiksa — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY\n' +
          '    tak terbaca dari .env.local. Periksa manual di Supabase Table Editor.\n',
      )
      test.info().annotations.push({
        type: 'tak diperiksa',
        description: 'Tabel orders tak bisa dibaca dari uji — kredensial Supabase tak tersedia.',
      })
      return
    }

    const laporan = baris.length
      ? baris
          .map(
            (b) =>
              `    ${b.nomor_invoice} | order_status=${b.order_status ?? 'NULL'} | ` +
              `status_pembayaran=${b.status_pembayaran ?? 'NULL'} | ` +
              `destination_id=${b.destination_id ?? 'NULL'} | Rp${b.jumlah_total} | ${b.created_at}`,
          )
          .join('\n')
      : '    (tidak ada)'

    console.log(`\n  Baris "orders" atas nama "${NAMA_PENGUJI}":\n${laporan}\n`)

    // Bila ADA baris, statusnya tetap diperiksa — supaya laporannya berguna, bukan sekadar merah.
    // Inilah yang kamu minta diperiksa manual: tak boleh NULL, tak boleh macet tanpa kejelasan.
    for (const b of baris) {
      expect(
        b.order_status,
        `order ${b.nomor_invoice} punya order_status NULL/kosong — status wajib selalu terisi`,
      ).toBeTruthy()
      expect(
        STATUS_FULFILLMENT_SAH,
        `order_status "${b.order_status}" di luar konvensi proyek`,
      ).toContain(b.order_status)
      expect(
        STATUS_PEMBAYARAN_SAH,
        `status_pembayaran "${b.status_pembayaran}" di luar konvensi proyek`,
      ).toContain(b.status_pembayaran)
    }

    expect(
      baris.length,
      `Pesanan TERCIPTA meski tujuannya tak valid — ${baris.length} baris tertinggal di tabel ` +
        `orders dan tak akan pernah bisa dikirim. Stok produk juga sudah terpotong.\n${laporan}\n` +
        `Hapus manual, lalu periksa cabang DESTINATION_UNSERVICEABLE di ` +
        `src/app/api/orders/create/route.ts.`,
    ).toBe(0)
  })
})
