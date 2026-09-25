// scripts/migrate-data.mjs
// Menyalin DATA KATALOG (bukan skema) dari Supabase SOURCE (.env.local) ke TARGET
// (.env.migration.local) — dipakai mengisi project PREVIEW dengan produk, harga, dan stok produksi.
// Skema di target harus SUDAH dibangun dari supabase/migrations. Memakai service_role (bypass RLS).
// Row disalin apa adanya (termasuk kolom `id`) agar relasi FK tetap utuh.
//
// Jalankan:
//   node scripts/migrate-data.mjs                                -> DRY RUN (hitung row, tak menulis)
//   node scripts/migrate-data.mjs --run                          -> salin (target harus kosong)
//   node scripts/migrate-data.mjs --run --replace --target=<ref> -> kosongkan target dulu, lalu salin
//
// SENGAJA TIDAK DISALIN: orders, order_items, reviews (nama, HP, alamat pembeli asli), admin_users
// (hash password admin produksi), stock_mutations (riwayat yang menunjuk pesanan & admin), dan
// mengantar_daily_pickup (slot penjemputan milik akun Mengantar produksi). Preview cukup butuh
// katalog yang sama persis dengan produksi; data pribadi tak perlu ikut berpindah.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// === Parse file .env sederhana (tanpa dependency dotenv) ===
function parseEnv(file) {
  const out = {}
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    // buang kutip pembungkus bila ada
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

const root = process.cwd()
const srcEnv = parseEnv(path.join(root, '.env.local'))
const tgtEnv = parseEnv(path.join(root, '.env.migration.local'))

const SRC_URL = srcEnv.NEXT_PUBLIC_SUPABASE_URL
const SRC_KEY = srcEnv.SUPABASE_SERVICE_ROLE_KEY
const TGT_URL = tgtEnv.TARGET_SUPABASE_URL
const TGT_KEY = tgtEnv.TARGET_SERVICE_ROLE_KEY

function refOf(url) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || '')
  return m ? m[1] : '(?)'
}

const RUN = process.argv.includes('--run')
const REPLACE = process.argv.includes('--replace')
const TARGET_CONFIRM = process.argv.find((a) => a.startsWith('--target='))?.slice('--target='.length)

// === Validasi kredensial & arah ===
const problems = []
if (!SRC_URL || !SRC_KEY) problems.push('SOURCE (.env.local) tidak lengkap: butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
if (!TGT_URL || !TGT_KEY) problems.push('TARGET (.env.migration.local) tidak lengkap: butuh TARGET_SUPABASE_URL + TARGET_SERVICE_ROLE_KEY')
if (SRC_URL && TGT_URL && refOf(SRC_URL) === refOf(TGT_URL)) problems.push('SOURCE dan TARGET menunjuk project yang SAMA — dibatalkan.')
// --replace MENGHAPUS isi target. Ref project wajib diketik ulang supaya .env.migration.local yang
// keliru (mis. berisi kredensial produksi) tak bisa mengosongkan database yang salah.
if (REPLACE && TARGET_CONFIRM !== refOf(TGT_URL)) {
  problems.push(`--replace menghapus data di target. Konfirmasi dengan --target=${refOf(TGT_URL)} (harus sama persis dengan ref TARGET).`)
}
if (problems.length) {
  console.error('❌ Konfigurasi bermasalah:\n - ' + problems.join('\n - '))
  process.exit(1)
}

// === Daftar tabel ===

// Disalin, urut dependency FK (induk dulu, anak belakangan)
const TABLES = [
  'products',
  'product_variants',
  'product_combos',
  'product_combo_items',
  'promotions',
  'warehouses',
  'product_stock_per_warehouse',
]

// store_settings di-UPSERT per key, bukan disisipkan: migration sudah men-seed min_order_amount,
// warehouse_mode, dan max_discount_percent di target, dan nilai produksi yang harus menang.
const SETTINGS_TABLE = 'store_settings'

// Dikosongkan oleh --replace, urut kebalikan FK (anak dulu). Selain tabel yang disalin, ikut juga
// tabel yang MENUNJUK ke sana: tanpa itu penghapusan products/promotions/warehouses ditolak FK.
// Isinya di preview hanyalah sisa salinan lama / uji coba — termasuk data pembeli yang memang tak
// seharusnya ada di preview.
const WIPE_ORDER = [
  'stock_mutations',
  'reviews',
  'order_items',
  'orders',
  'product_stock_per_warehouse',
  'warehouses',
  'promotions',
  'product_combo_items',
  'product_combos',
  'product_variants',
  'products',
]

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } })
const tgt = createClient(TGT_URL, TGT_KEY, { auth: { persistSession: false } })

const PAGE = 1000 // batas baca per request
const CHUNK = 500 // batas insert per request

// Ambil seluruh row satu tabel (paginasi)
async function fetchAll(client, table) {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await client.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`baca ${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

// Hitung jumlah row (head + count)
async function countRows(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
}

async function insertChunks(table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await tgt.from(table).insert(rows.slice(i, i + CHUNK))
    if (error) throw new Error(`insert ${table} (offset ${i}): ${error.message}`)
  }
  return rows.length
}

// Hapus seluruh row satu tabel di target. PostgREST menolak DELETE tanpa filter, jadi dipakai
// filter yang selalu benar untuk kolom primary key.
async function wipe(table) {
  const { error } = await tgt.from(table).delete().not('id', 'is', null)
  if (error) throw new Error(`hapus ${table}: ${error.message}`)
}

async function main() {
  console.log(`SOURCE : ${refOf(SRC_URL)}.supabase.co`)
  console.log(`TARGET : ${refOf(TGT_URL)}.supabase.co`)
  console.log(`MODE   : ${RUN ? (REPLACE ? 'RUN + REPLACE (kosongkan target, lalu salin)' : 'RUN (salin)') : 'DRY RUN (hanya hitung)'}\n`)

  // === 1. Periksa kedua sisi ===
  const counts = {}
  for (const table of [...TABLES, SETTINGS_TABLE]) {
    const [s, t] = await Promise.all([countRows(src, table), countRows(tgt, table)])
    counts[table] = { s, t }
    console.log(`• ${table.padEnd(28)} source=${String(s).padEnd(5)} target=${t}`)
  }

  if (!RUN) {
    console.log('\nℹ️  Dry run selesai, tidak ada yang ditulis.')
    console.log('   Target berisi data? Jalankan dengan --run --replace --target=' + refOf(TGT_URL))
    console.log('   Target kosong?      Jalankan dengan --run')
    return
  }

  // === 2. Target harus kosong, atau dikosongkan eksplisit ===
  // Dulu tabel berisi DILEWATI satu per satu. Itu menghasilkan campuran: produk lama dengan stok
  // baru, atau gudang seed migration dengan stok yang menunjuk gudang produksi. Sekarang semua atau
  // tidak sama sekali — dan keputusan menghapus diambil manusia lewat --replace.
  const terisi = TABLES.filter((t) => counts[t].t > 0)
  if (terisi.length && !REPLACE) {
    console.error(`\n❌ Target sudah berisi data di: ${terisi.join(', ')}. Tidak ada yang ditulis.`)
    console.error(`   Kosongkan dulu dengan: node scripts/migrate-data.mjs --run --replace --target=${refOf(TGT_URL)}`)
    process.exit(1)
  }

  if (REPLACE) {
    console.log('\n— Mengosongkan target —')
    for (const table of WIPE_ORDER) {
      await wipe(table)
      console.log(`• ${table.padEnd(28)} dikosongkan`)
    }
  }

  // === 3. Salin katalog ===
  console.log('\n— Menyalin —')
  for (const table of TABLES) {
    if (counts[table].s === 0) {
      console.log(`• ${table.padEnd(28)} source kosong → dilewati`)
      continue
    }
    const rows = await fetchAll(src, table)
    const n = await insertChunks(table, rows)
    console.log(`• ${table.padEnd(28)} disalin ${n} row ✔`)
  }

  // === 4. Pengaturan toko (upsert per key) ===
  const settings = await fetchAll(src, SETTINGS_TABLE)
  const { error } = await tgt
    .from(SETTINGS_TABLE)
    .upsert(settings.map(({ key, value }) => ({ key, value })), { onConflict: 'key' })
  if (error) throw new Error(`upsert ${SETTINGS_TABLE}: ${error.message}`)
  console.log(`• ${SETTINGS_TABLE.padEnd(28)} ${settings.length} key diselaraskan ✔`)

  console.log('\n✅ Selesai. Pesanan, ulasan, dan akun admin sengaja tidak disalin.')
}

main().catch((e) => {
  console.error('\n❌ Gagal:', e.message)
  process.exit(1)
})
