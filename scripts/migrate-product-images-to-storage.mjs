// scripts/migrate-product-images-to-storage.mjs
// Migrasi SATU KALI: pindahkan foto produk yang masih base64 (data:image/...) di kolom
// image_url & images → upload ke Supabase Storage (bucket product-images) → ganti jadi URL.
//
// Jalankan dari root project:  node scripts/migrate-product-images-to-storage.mjs
// Membaca kredensial dari .env.local (service_role). Idempoten: produk yang sudah URL dilewati.
// Foto lama di DB TIDAK dihapus dari mana pun (base64 hanya diganti isinya di kolom).

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// --- Muat .env.local ---
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const BUCKET = 'product-images'
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// data-URL base64 → upload → URL publik. Bukan data-URL → kembalikan apa adanya.
async function toStorageUrl(value) {
  if (!value || !value.startsWith('data:')) return value
  const m = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return value
  const mime = m[1]
  const ext = MIME_EXT[mime] ?? 'bin'
  const buffer = Buffer.from(m[2], 'base64')
  const path = `products/${randomUUID()}.${ext}`
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false })
  if (error) throw new Error('upload gagal: ' + error.message)
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

async function main() {
  const { data, error } = await sb.from('products').select('id, name, image_url, images')
  if (error) throw new Error(error.message)

  let migrated = 0
  let skipped = 0
  for (const p of data) {
    const imgs = Array.isArray(p.images) ? p.images : []
    const needsImageUrl = (p.image_url || '').startsWith('data:')
    const needsGallery = imgs.some((x) => (x || '').startsWith('data:'))
    if (!needsImageUrl && !needsGallery) {
      skipped++
      continue
    }

    const newImageUrl = needsImageUrl ? await toStorageUrl(p.image_url) : p.image_url
    const newImages = needsGallery ? await Promise.all(imgs.map((x) => toStorageUrl(x))) : imgs

    const { error: upErr } = await sb
      .from('products')
      .update({ image_url: newImageUrl, images: newImages })
      .eq('id', p.id)
    if (upErr) {
      console.error(`✗ ${p.name} (${p.id}):`, upErr.message)
      continue
    }
    migrated++
    console.log(`✓ ${p.name}: image_url + ${newImages.length} galeri → URL Storage`)
  }

  console.log(`\nSelesai. Dimigrasi: ${migrated} | dilewati (sudah URL): ${skipped} | total: ${data.length}`)
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
