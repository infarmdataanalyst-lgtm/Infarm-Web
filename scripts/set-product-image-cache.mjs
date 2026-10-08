// scripts/set-product-image-cache.mjs
// SATU KALI: menyetel ulang Cache-Control seluruh berkas di bucket product-images menjadi 1 tahun.
//
// Kenapa perlu: Cache-Control sebuah berkas Storage ditetapkan SAAT diunggah dan tak bisa diubah
// lewat kolom metadata saja — berkas harus diunggah ulang ke path yang SAMA (upsert). URL di
// tabel products tidak berubah, jadi tak ada yang perlu disentuh di database.
//
// Aman diulang (idempoten): berkas yang sudah 1 tahun dilewati. Berkas yang gagal dilaporkan dan
// skrip lanjut ke berkas berikutnya.
//
// Jalankan dari root project:  node scripts/set-product-image-cache.mjs
// Tambahkan --dry-run untuk hanya melihat daftar tanpa mengubah apa pun.
// Membaca kredensial dari .env.local (service_role), seperti migrate-product-images-to-storage.mjs.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// --- Muat .env.local ---
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const BUCKET = 'product-images'
const FOLDER = 'products'
// Sama dengan IMAGE_CACHE_SECONDS di src/lib/mock-db/products.ts (tak diimpor: berkas itu
// 'server-only' dan menyeret modul Next).
const CACHE_SECONDS = '31536000'
const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function main() {
  const { data: files, error } = await sb.storage
    .from(BUCKET)
    .list(FOLDER, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (error) throw new Error('list gagal: ' + error.message)

  let updated = 0
  let skipped = 0
  let failed = 0
  for (const f of files) {
    const path = `${FOLDER}/${f.name}`
    const current = f.metadata?.cacheControl ?? ''
    if (current === `max-age=${CACHE_SECONDS}`) {
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`· ${path}: ${current || '(kosong)'} → max-age=${CACHE_SECONDS}`)
      updated++
      continue
    }

    // Unduh isi asli lalu unggah ulang ke path yang sama dengan Cache-Control baru.
    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(path)
    if (dlErr) {
      failed++
      console.error(`✗ ${path}: unduh gagal — ${dlErr.message}`)
      continue
    }
    const { error: upErr } = await sb.storage.from(BUCKET).update(path, blob, {
      contentType: f.metadata?.mimetype ?? blob.type,
      cacheControl: CACHE_SECONDS,
      upsert: true,
    })
    if (upErr) {
      failed++
      console.error(`✗ ${path}: unggah ulang gagal — ${upErr.message}`)
      continue
    }
    updated++
    console.log(`✓ ${path}: ${current || '(kosong)'} → max-age=${CACHE_SECONDS}`)
  }

  console.log(
    `\nSelesai${DRY_RUN ? ' (dry-run, tak ada yang diubah)' : ''}: ` +
      `${updated} diperbarui, ${skipped} sudah 1 tahun, ${failed} gagal, total ${files.length} berkas.`,
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
