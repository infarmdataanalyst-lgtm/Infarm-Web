// tests/e2e/_tmp-xendit-contract.spec.ts
// SEMENTARA — dibuat untuk sesi audit integrasi Xendit. Hapus setelah laporan selesai.
//
// Menguji KONTRAK REQUEST yang dibangun kode produksi, dengan `fetch` di-stub sehingga
// TIDAK ADA panggilan ke api.xendit.co (CLAUDE.md -> Panggilan API Berbayar).
// Data pesanan diambil NYATA dari Supabase (read-only, tanpa menulis apa pun).

import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import Module from 'node:module'
import path from 'node:path'
import type { Order } from '../../src/types/order'

// Playwright tidak membaca `paths` dari tsconfig project ini (tak ada baseUrl), jadi alias `@/`
// dipetakan manual DI SINI. Tak ada file project yang diubah untuk keperluan uji.
const SRC = path.resolve(process.cwd(), 'src')
const _resolve = (Module as any)._resolveFilename
;(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    request = path.join(SRC, request.slice(2))
  }
  return _resolve.call(this, request, ...rest)
}

async function loadEnv() {
  const raw = await readFile('.env.local', 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
}

async function fetchRealPendingOrder(): Promise<{ row: Record<string, any>; order: Order }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const cols =
    'id,nomor_invoice,nama_customer,no_telepon,jumlah_total,ongkos_kirim,status_pembayaran,order_status,created_at,id_transaksi'
  const q =
    `${url}/rest/v1/orders?select=${cols}&status_pembayaran=eq.PENDING&order_status=eq.PENDING` +
    `&nomor_invoice=not.is.null&order=created_at.desc&limit=1`
  const rows = await (await fetch(q, { headers: H })).json()
  const row = rows[0]
  // Pemetaan mengikuti rowToOrder() di src/lib/mock-db/orders.ts
  const order = {
    orderId: row.nomor_invoice,
    customerName: row.nama_customer,
    customerPhone: row.no_telepon,
    date: row.created_at,
    items: [],
    totalAmount: row.jumlah_total,
    paymentStatus: 'Menunggu',
  } as unknown as Order
  return { row, order }
}

type Captured = { url: string; method?: string; headers: Record<string, string>; body: any }

function stubFetch(responseBody: unknown, status = 200) {
  const captured: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    captured.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body) : undefined,
    })
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return {
    captured,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test.describe.configure({ mode: 'serial' })

test('KONTRAK 1: payload Payment Request (VA) dari createVirtualAccount()', async () => {
  await loadEnv()
  const { row, order } = await fetchRealPendingOrder()
  const { createVirtualAccount } = await import('../../src/lib/xendit/payment-request')

  console.log('\n=== ORDER NYATA DARI SUPABASE (read-only) ===')
  console.log('  orders.id            :', row.id)
  console.log('  orders.nomor_invoice :', row.nomor_invoice)
  console.log('  orders.jumlah_total  :', row.jumlah_total, `(typeof ${typeof row.jumlah_total})`)
  console.log('  orders.ongkos_kirim  :', row.ongkos_kirim)
  console.log('  orders.id_transaksi  :', row.id_transaksi)

  const fakeResponse = {
    id: 'pr-STUB-0001',
    reference_id: order.orderId,
    status: 'REQUIRES_ACTION',
    payment_method: {
      type: 'VIRTUAL_ACCOUNT',
      virtual_account: {
        channel_code: 'BNI',
        channel_properties: {
          virtual_account_number: '8808123456789012',
          expires_at: '2026-08-30T00:00:00.000Z',
        },
      },
    },
  }

  const { captured, restore } = stubFetch(fakeResponse)
  let result: any
  try {
    result = await createVirtualAccount(order, 'bni', Date.parse('2026-08-29T00:00:00.000Z'))
  } finally {
    restore()
  }

  console.log('\n=== REQUEST YANG DIBANGUN (ditangkap, TIDAK dikirim ke Xendit) ===')
  console.log('  URL    :', captured[0]?.url)
  console.log('  Method :', captured[0]?.method)
  console.log(
    '  Header :',
    Object.keys(captured[0]?.headers ?? {}).join(', '),
    '| Authorization =',
    captured[0]?.headers?.Authorization ? '<ADA, disensor>' : '<TIDAK ADA>',
  )
  console.log('  Idempotency-key :', captured[0]?.headers?.['Idempotency-key'])
  console.log('  BODY:', JSON.stringify(captured[0]?.body, null, 2))
  console.log('\n=== HASIL PEMETAAN RESPONS (respons stub berbentuk dokumentasi) ===')
  console.log(' ', JSON.stringify(result, null, 2))

  const body = captured[0].body
  expect(body.reference_id).toBe(row.nomor_invoice)
  expect(body.request_amount).toBe(row.jumlah_total)
  expect(body.payment_method.virtual_account.channel_code).toBe('BNI')
  expect(Number.isInteger(body.request_amount)).toBe(true)
  expect(typeof body.request_amount).toBe('number')
  expect(String(body.request_amount)).not.toContain('.')
  expect(body.currency).toBe('IDR')
  expect(captured[0].headers['Idempotency-key']).toBe(row.nomor_invoice)
})

test('KONTRAK 2: pemetaan metode UI -> channel_code Xendit', async () => {
  await loadEnv()
  const { row, order } = await fetchRealPendingOrder()
  const { createVirtualAccount, supportedVaMethodIds } = await import(
    '../../src/lib/xendit/payment-request'
  )
  const { PAYMENT_METHODS } = await import('../../src/lib/data/dummy-checkout')

  const supported = supportedVaMethodIds()
  console.log('\n=== METODE DI PAYMENT_METHODS vs JALUR VA ===')
  for (const m of PAYMENT_METHODS) {
    const ok = supported.includes(m.id)
    console.log(
      `  ${m.id.padEnd(12)} grup=${String(m.group).padEnd(6)} -> ${ok ? 'DIDUKUNG createVirtualAccount' : 'DITOLAK (unsupported-channel)'}`,
    )
  }

  console.log('\n=== channel_code aktual yang dikirim per bank ===')
  for (const id of supported) {
    const { captured, restore } = stubFetch({
      id: 'pr-STUB',
      status: 'REQUIRES_ACTION',
      payment_method: {
        virtual_account: {
          channel_code: 'X',
          channel_properties: { virtual_account_number: '1', expires_at: 'z' },
        },
      },
    })
    try {
      await createVirtualAccount(order, id)
    } finally {
      restore()
    }
    console.log(
      `  ${id.padEnd(10)} -> ${captured[0].body.payment_method.virtual_account.channel_code}`,
    )
  }

  console.log('\n=== metode NON-VA lewat jalur VA (harus ditolak SEBELUM fetch) ===')
  for (const id of ['qris', 'ovo', 'shopeepay', 'alfamart', 'akulaku', 'cc', 'danamon']) {
    const { captured, restore } = stubFetch({})
    let r: any
    try {
      r = await createVirtualAccount(order, id)
    } finally {
      restore()
    }
    console.log(
      `  ${id.padEnd(10)} -> ok=${r.ok} reason=${r.reason ?? '-'} | fetch dipanggil ${captured.length}x`,
    )
    expect(r.ok).toBe(false)
    expect(captured.length).toBe(0)
  }
  expect(row.nomor_invoice).toBeTruthy()
})

test('KONTRAK 3: payload Invoice API dari createXenditInvoice() — JALUR CHECKOUT SEBENARNYA', async () => {
  await loadEnv()
  const { row, order } = await fetchRealPendingOrder()
  const { createXenditInvoice } = await import('../../src/lib/xendit/invoice')

  const fakeResponse = {
    id: 'inv-STUB-0001',
    external_id: order.orderId,
    status: 'PENDING',
    amount: row.jumlah_total,
    invoice_url: 'https://checkout-staging.xendit.co/web/STUB',
    expiry_date: '2026-08-30T00:00:00.000Z',
  }

  const { captured, restore } = stubFetch(fakeResponse)
  let result: any
  try {
    result = await createXenditInvoice(order, 'http://localhost:3000')
  } finally {
    restore()
  }

  console.log('\n=== REQUEST INVOICE API (ditangkap, TIDAK dikirim) ===')
  console.log('  URL  :', captured[0]?.url)
  console.log('  BODY :', JSON.stringify(captured[0]?.body, null, 2))
  console.log('\n=== HASIL PEMETAAN RESPONS ===')
  console.log(' ', JSON.stringify(result, null, 2))

  const body = captured[0].body
  expect(body.external_id).toBe(row.nomor_invoice)
  expect(body.amount).toBe(row.jumlah_total)
  expect(Number.isInteger(body.amount)).toBe(true)
  expect(body.currency).toBe('IDR')
})

test('KONTRAK 4: parser webhook memetakan balik ke nomor_invoice', async () => {
  await loadEnv()
  const { row } = await fetchRealPendingOrder()
  const wh = await import('../../src/lib/xendit/webhook')

  const parsedInvoice = wh.parseInvoiceCallback({
    id: 'inv-STUB-0001',
    external_id: row.nomor_invoice,
    status: 'PAID',
    paid_amount: row.jumlah_total,
    payment_method: 'BANK_TRANSFER',
    payment_channel: 'BCA',
  })
  console.log('\n=== parseInvoiceCallback (bentuk Invoice API) ===')
  console.log(' ', JSON.stringify(parsedInvoice, null, 2))

  const parsedPr = wh.parsePaymentRequestCallback({
    event: 'payment.succeeded',
    data: {
      id: 'pay-STUB',
      payment_request_id: 'pr-STUB-0001',
      reference_id: row.nomor_invoice,
      status: 'SUCCEEDED',
      amount: row.jumlah_total,
      payment_method: { type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: 'BNI' } },
    },
  })
  console.log('\n=== parsePaymentRequestCallback (bentuk Payments v3) ===')
  console.log(' ', JSON.stringify(parsedPr, null, 2))

  expect(parsedInvoice?.invoice).toBe(row.nomor_invoice)
  expect(parsedInvoice?.paymentMethod).toBe('BCA')
  expect(parsedPr?.invoice).toBe(row.nomor_invoice)
  expect(parsedPr?.paymentMethod).toBe('BNI')
})

// === Tambahan sesi audit: skenario KEGAGALAN (Edge Case) ===

test('EDGE: Xendit menolak / koneksi putus -> tidak crash, alasan terpetakan', async () => {
  await loadEnv()
  const { order } = await fetchRealPendingOrder()
  const { createXenditInvoice } = await import('../../src/lib/xendit/invoice')
  const { createVirtualAccount } = await import('../../src/lib/xendit/payment-request')

  const skenario: Array<[string, () => { restore: () => void }]> = [
    ['Xendit tolak 400 API_VALIDATION_ERROR', () =>
      stubFetch({ error_code: 'API_VALIDATION_ERROR', message: 'amount must be greater than 0' }, 400)],
    ['Xendit error 500', () => stubFetch({ error_code: 'SERVER_ERROR', message: 'internal' }, 500)],
    ['Xendit balas bukan JSON', () => {
      const original = globalThis.fetch
      globalThis.fetch = (async () => new Response('<html>gateway error</html>', { status: 200 })) as typeof fetch
      return { restore: () => { globalThis.fetch = original } }
    }],
    ['respons 200 tapi tanpa invoice_url', () => stubFetch({ id: 'inv-x' }, 200)],
    ['koneksi putus / timeout', () => {
      const original = globalThis.fetch
      globalThis.fetch = (async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e }) as typeof fetch
      return { restore: () => { globalThis.fetch = original } }
    }],
  ]

  console.log('\n=== createXenditInvoice() saat Xendit bermasalah ===')
  for (const [label, mk] of skenario) {
    const { restore } = mk()
    let r: any
    try { r = await createXenditInvoice(order, 'http://localhost:3000') }
    catch (e) { r = { CRASH: String(e) } }
    finally { restore() }
    console.log(`  ${label.padEnd(40)} -> ok=${r.ok} reason=${r.reason ?? '-'} | detail: ${String(r.detail ?? r.CRASH ?? '').slice(0, 70)}`)
    expect(r.CRASH).toBeUndefined()
    expect(r.ok).toBe(false)
  }

  console.log('\n=== createVirtualAccount() saat Xendit bermasalah ===')
  for (const [label, mk] of skenario) {
    const { restore } = mk()
    let r: any
    try { r = await createVirtualAccount(order, 'bni') }
    catch (e) { r = { CRASH: String(e) } }
    finally { restore() }
    console.log(`  ${label.padEnd(40)} -> ok=${r.ok} reason=${r.reason ?? '-'}`)
    expect(r.CRASH).toBeUndefined()
    expect(r.ok).toBe(false)
  }
})

test('EDGE: pesan teknis Xendit TIDAK bocor ke pembeli', async () => {
  await loadEnv()
  const fs = await import('node:fs/promises')
  const inv = await fs.readFile('src/app/api/payments/invoice/route.ts', 'utf-8')
  const va = await fs.readFile('src/app/api/payments/create/route.ts', 'utf-8')

  const alasan = ['not-configured', 'blocked-environment', 'invalid-order', 'http-error', 'no-invoice-url', 'network']
  console.log('\n=== Peta alasan teknis -> pesan untuk pembeli (payments/invoice) ===')
  for (const a of alasan) {
    const ada = inv.includes(`'${a}'`) || inv.includes(`${a}:`)
    console.log(`  ${a.padEnd(22)} punya pesan publik: ${ada}`)
    expect(ada).toBe(true)
  }
  // `result.detail` (memuat pesan mentah Xendit) hanya boleh masuk console, bukan NextResponse
  const detailKeUser = /NextResponse\.json\([^)]*result\.detail/s.test(inv) || /NextResponse\.json\([^)]*result\.detail/s.test(va)
  console.log(`\n  detail mentah Xendit ikut dikirim ke pembeli? ${detailKeUser}`)
  expect(detailKeUser).toBe(false)
})
