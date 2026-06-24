// scripts/diagnose-supabase.mjs
// Tes Level 1: verifikasi tabel orders & reviews di Supabase (schema + insert/select).
// Membuat baris uji lalu menghapusnya kembali. Jalankan: node scripts/diagnose-supabase.mjs

import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

// Muat .env.local manual
const env = {}
const raw = await readFile(new URL('../.env.local', import.meta.url), 'utf-8')
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let ok = true

// === Tes tabel ORDERS ===
console.log('=== ORDERS ===')
const orderIns = await supabase
  .from('orders')
  .insert({
    order_id: `DIAG-ORD-${Date.now()}`,
    customer_name: 'Pelanggan Uji',
    customer_phone: '08123456789',
    order_date: '2026-06-22T10:00:00.000Z',
    items: [{ productId: 'p1', name: 'Produk Uji', quantity: 2, price: 15000 }],
    total_amount: 30000,
    payment_status: 'Lunas',
    status: 'Diproses',
    courier: 'JNE',
    service: 'Reguler',
    tracking_number: 'UJI123',
  })
  .select('*')
  .single()

if (orderIns.error) {
  ok = false
  console.error('INSERT orders gagal:', orderIns.error.message, '| kode:', orderIns.error.code)
} else {
  console.log('INSERT ok. id:', orderIns.data.id, '| items tersimpan:', JSON.stringify(orderIns.data.items))
  const sel = await supabase.from('orders').select('order_id, total_amount').eq('id', orderIns.data.id).single()
  console.log('SELECT kembali:', sel.error ? `gagal: ${sel.error.message}` : JSON.stringify(sel.data))
  await supabase.from('orders').delete().eq('id', orderIns.data.id)
  console.log('Baris uji orders dihapus.')
}

// === Tes tabel REVIEWS (perlu product_id valid -> buat produk sementara) ===
console.log('\n=== REVIEWS ===')
const prod = await supabase
  .from('products')
  .insert({
    name: 'Produk Uji Review',
    original_price: 1000,
    promo_price: 1000,
    image_url: '/images/product-placeholder.png',
    category: 'benih-premium',
    sku: `DIAG-REV-${Date.now()}`,
    stock: 1,
  })
  .select('id')
  .single()

if (prod.error) {
  ok = false
  console.error('Gagal buat produk sementara:', prod.error.message)
} else {
  const revIns = await supabase
    .from('reviews')
    .insert({
      product_id: prod.data.id,
      author_name: 'Pengulas Uji',
      rating: 5,
      comment: 'Ulasan uji diagnosa.',
      category: 'Kualitas',
      image_urls: ['/images/product-placeholder.png'],
      visible: true,
    })
    .select('*')
    .single()

  if (revIns.error) {
    ok = false
    console.error('INSERT reviews gagal:', revIns.error.message, '| kode:', revIns.error.code)
  } else {
    console.log('INSERT ok. id:', revIns.data.id, '| rating:', revIns.data.rating)
    // Uji constraint rating (harus DITOLAK karena di luar 1-5)
    const bad = await supabase
      .from('reviews')
      .insert({ product_id: prod.data.id, author_name: 'x', rating: 9, comment: 'rating ilegal' })
      .select('id')
      .single()
    console.log('Tes rating ilegal (9):', bad.error ? `DITOLAK ✓ (${bad.error.code})` : 'LOLOS ✗ (harusnya ditolak!)')
  }

  // Hapus produk -> review ikut terhapus (ON DELETE CASCADE)
  await supabase.from('products').delete().eq('id', prod.data.id)
  const leftover = await supabase.from('reviews').select('id').eq('product_id', prod.data.id)
  console.log('Cascade delete review saat produk dihapus:', (leftover.data?.length ?? 0) === 0 ? 'OK ✓' : 'GAGAL ✗')
}

console.log('\n' + (ok ? 'SEMUA TES LEVEL 1 LULUS ✓' : 'ADA TES YANG GAGAL ✗'))
