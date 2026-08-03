// scripts/migrate-data.mjs
// Menyalin DATA (bukan skema) dari Supabase SOURCE (.env.local) ke TARGET (.env.migration.local).
// Skema/tabel di target diasumsikan SUDAH ada & identik. Memakai service_role (bypass RLS).
// Row disalin apa adanya (termasuk kolom `id`) agar relasi FK tetap utuh.
//
// Jalankan:
//   node scripts/migrate-data.mjs           -> DRY RUN (hitung row source vs target, tak menulis)
//   node scripts/migrate-data.mjs --run     -> eksekusi penyalinan
//
// Keamanan: tabel yang di target SUDAH berisi data akan DILEWATI (tak menimpa) agar aman/idempotent.

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

// === Validasi kredensial & arah ===
const problems = []
if (!SRC_URL || !SRC_KEY) problems.push('SOURCE (.env.local) tidak lengkap: butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
if (!TGT_URL || !TGT_KEY) problems.push('TARGET (.env.migration.local) tidak lengkap: butuh TARGET_SUPABASE_URL + TARGET_SERVICE_ROLE_KEY')
if (SRC_URL && TGT_URL && refOf(SRC_URL) === refOf(TGT_URL)) problems.push('SOURCE dan TARGET menunjuk project yang SAMA — dibatalkan.')
if (problems.length) {
  console.error('❌ Konfigurasi bermasalah:\n - ' + problems.join('\n - '))
  process.exit(1)
}

const RUN = process.argv.includes('--run')

// Urutan penyalinan mengikuti dependency FK (induk dulu, anak belakangan)
const TABLES = [
  'products',
  'product_variants',
  'product_combos',
  'product_combo_items',
  'promotions',
  'orders',
  'order_items',
  'reviews',
  'admin_users',
]

// Transform per-tabel: benahi nilai yang melanggar constraint target.
// orders lama di source punya status null → target NOT NULL default 'PENDING'.
const TRANSFORMS = {
  orders: (r) => ({
    ...r,
    status_pembayaran: r.status_pembayaran ?? 'PENDING',
    order_status: r.order_status ?? 'PENDING',
  }),
}

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } })
const tgt = createClient(TGT_URL, TGT_KEY, { auth: { persistSession: false } })

const PAGE = 1000 // batas baca per request
const CHUNK = 500 // batas insert per request

// Ambil seluruh row satu tabel dari source (paginasi)
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

// Hitung jumlah row (head + count) — untuk dry run & cek target kosong
async function countRows(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
}

async function insertChunks(table, rows) {
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await tgt.from(table).insert(chunk)
    if (error) throw new Error(`insert ${table} (offset ${i}): ${error.message}`)
    done += chunk.length
  }
  return done
}

async function main() {
  console.log(`SOURCE : ${refOf(SRC_URL)} .supabase.co`)
  console.log(`TARGET : ${refOf(TGT_URL)} .supabase.co`)
  console.log(`MODE   : ${RUN ? 'RUN (menulis ke target)' : 'DRY RUN (hanya hitung)'}\n`)

  for (const table of TABLES) {
    let srcCount, tgtCount
    try {
      ;[srcCount, tgtCount] = await Promise.all([countRows(src, table), countRows(tgt, table)])
    } catch (e) {
      console.log(`• ${table.padEnd(22)} ❌ ${e.message}`)
      continue
    }

    if (!RUN) {
      console.log(`• ${table.padEnd(22)} source=${srcCount}  target=${tgtCount}`)
      continue
    }

    // Aman: jangan timpa tabel target yang sudah berisi data
    if (tgtCount > 0) {
      console.log(`• ${table.padEnd(22)} target sudah berisi ${tgtCount} row → DILEWATI`)
      continue
    }
    if (srcCount === 0) {
      console.log(`• ${table.padEnd(22)} source kosong → dilewati`)
      continue
    }

    let rows = await fetchAll(src, table)
    const tf = TRANSFORMS[table]
    if (tf) rows = rows.map(tf)
    const inserted = await insertChunks(table, rows)
    console.log(`• ${table.padEnd(22)} disalin ${inserted}/${srcCount} row ✔`)
  }

  console.log(`\n${RUN ? '✅ Selesai.' : 'ℹ️  Dry run selesai. Jalankan ulang dengan --run untuk menyalin.'}`)
}

main().catch((e) => {
  console.error('\n❌ Gagal:', e.message)
  process.exit(1)
})
