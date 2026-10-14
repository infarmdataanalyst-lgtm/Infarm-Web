// scripts/import-produk.ts
// Impor produk massal dari spreadsheet (+ foto) langsung ke Supabase, dijalankan di laptop admin.
// Vercel TIDAK terlibat: foto diolah & diunggah dari laptop ke Supabase Storage, data ditulis
// langsung ke database. Panduan lengkap: docs/impor-produk.md.
//
//   npm run impor-produk -- "<paket.zip | folder | produk.csv | produk.xlsx>" [masukan lain…]
//   npm run impor-produk -- "<…>" --simpan            ← benar-benar menyimpan
//   npm run impor-produk -- "<…>" --simpan --tampilkan  ← produk langsung tampil di toko
//
// Tanpa --simpan skrip HANYA memeriksa (spreadsheet, foto, SKU ganda di database) dan tidak
// mengubah apa pun. Laporan ditulis ke layar dan ke berkas laporan-impor-*.txt di samping masukan
// pertama, supaya bisa diteruskan apa adanya ke tim sales.
//
// Yang ditulis per produk, sama dengan produk yang dibuat lewat OMS (lib/mock-db/products.ts →
// saveProduct, lib/mock-db/variants.ts → createVariant):
//   1. foto → WebP maks. 1200 px → Storage `product-images/products/<uuid>.webp`, cache 1 tahun
//   2. baris `products` (badge "Baru", stok 0, `archived` = true kecuali --tampilkan)
//   3. baris `product_variants` (stok 0)
//   4. baris `product_stock_per_warehouse` stok 0 di gudang default
// Stok SENGAJA 0: diisi tim gudang lewat OMS → Kelola Stok Gudang, yang sekaligus mencatat riwayat
// mutasinya. Produk disembunyikan secara bawaan supaya pembeli tak melihat deretan "stok habis";
// tampilkan lewat OMS → Produk → Pulihkan setelah stoknya terisi.
//
// Bila satu langkah gagal, produk itu dibatalkan seluruhnya (baris & foto yang sudah terunggah
// dihapus) dan skrip lanjut ke produk berikutnya.

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { buildPlan, isPhotoName, matchPhotos, type ImportIssue, type PlannedProduct } from '@/lib/product-import/plan'
import { readSheet } from '@/lib/product-import/sheet-reader'

const BUCKET = 'product-images'
const FOLDER = 'products'
// Sama dengan IMAGE_CACHE_SECONDS di src/lib/mock-db/products.ts (tak diimpor: berkas itu
// 'server-only').
const CACHE_SECONDS = '31536000'
const PHOTO_MAX_PX = 1200
const PHOTO_QUALITY = 82
const PHOTO_INPUT_MAX_BYTES = 25 * 1024 * 1024

const args = process.argv.slice(2)
const SAVE = args.includes('--simpan')
const SHOW = args.includes('--tampilkan')
const SKIP_INVALID = args.includes('--lewati-salah')
const inputs = args.filter((a) => !a.startsWith('--'))

// === Laporan ===
const lines: string[] = []
function say(line = '') {
  lines.push(line)
  console.log(line)
}
function formatIssue(i: ImportIssue): string {
  const where = [i.row ? `baris ${i.row}` : '', i.sku ?? ''].filter(Boolean).join(' · ')
  return `  - ${where ? `[${where}] ` : ''}${i.message}`
}
function kb(n: number): string {
  return `${Math.round(n / 1024)} KB`
}

// === Masukan: ZIP, folder, atau berkas ===
type Entry = { name: string; source: string; read: () => Uint8Array }

function collect(path: string): Entry[] {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`Tidak ditemukan: ${path}`)
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const full = join(d.parentPath, d.name)
        return { name: d.name, source: full, read: () => new Uint8Array(readFileSync(full)) }
      })
  }
  if (extname(abs).toLowerCase() === '.zip') {
    const files = unzipSync(new Uint8Array(readFileSync(abs)))
    return Object.entries(files)
      .filter(([p]) => !p.endsWith('/') && !p.startsWith('__MACOSX/'))
      .map(([p, bytes]) => ({ name: basename(p), source: `${basename(abs)}/${p}`, read: () => bytes }))
  }
  return [{ name: basename(abs), source: abs, read: () => new Uint8Array(readFileSync(abs)) }]
}

function loadEnv() {
  const env = readFileSync('.env.local', 'utf8')
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function processPhoto(bytes: Uint8Array): Promise<Buffer> {
  if (bytes.byteLength > PHOTO_INPUT_MAX_BYTES) throw new Error('lebih dari 25 MB')
  return sharp(bytes, { failOn: 'error' })
    .rotate() // ikuti orientasi EXIF dari kamera HP
    .resize({ width: PHOTO_MAX_PX, height: PHOTO_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: PHOTO_QUALITY })
    .toBuffer()
}

async function main() {
  if (inputs.length === 0) {
    console.log('Pemakaian: npm run impor-produk -- "<paket.zip | folder | produk.csv>" [--simpan] [--tampilkan]')
    process.exit(1)
  }

  say(`Impor produk — ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`)
  say(SAVE ? `Mode: SIMPAN (produk ${SHOW ? 'langsung tampil' : 'disembunyikan'} di toko)` : 'Mode: PERIKSA SAJA (tidak ada yang disimpan)')
  say()

  // 1. Kumpulkan berkas
  const entries = inputs.flatMap(collect)
  const sheets = entries.filter((e) => /\.(csv|xlsx)$/i.test(e.name) && !e.name.startsWith('~$'))
  if (sheets.length !== 1) {
    say(
      sheets.length === 0
        ? '❌ Spreadsheet (.csv / .xlsx) tidak ditemukan di masukan.'
        : `❌ Ada ${sheets.length} spreadsheet: ${sheets.map((s) => s.source).join(', ')}. Sisakan satu, atau sebutkan berkasnya langsung.`,
    )
    return finish(1)
  }
  const sheet = sheets[0]
  const photoEntries = new Map<string, Entry>()
  for (const e of entries) if (isPhotoName(e.name)) photoEntries.set(e.name, e)
  say(`Spreadsheet: ${sheet.source}`)
  say(`Foto ditemukan: ${photoEntries.size} berkas`)
  say()

  // 2. Rencana dari spreadsheet + pencocokan foto
  const { products, issues } = buildPlan(readSheet(sheet.name, sheet.read()))
  const photos = matchPhotos(
    [...photoEntries.keys()].map((name) => ({ name })),
    products.map((p) => p.sku),
  )
  const blocked = new Map<string, ImportIssue[]>() // SKU → kesalahan
  const block = (i: ImportIssue) => {
    const key = i.sku ?? '(umum)'
    blocked.set(key, [...(blocked.get(key) ?? []), i])
  }
  photos.issues.forEach(block)

  // 3. SKU yang sudah ada di database
  loadEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const allSkus = products.flatMap((p) => [p.sku, ...p.variants.map((v) => v.sku)])
  if (allSkus.length > 0) {
    const [{ data: pRows, error: pErr }, { data: vRows, error: vErr }] = await Promise.all([
      supabase.from('products').select('sku').in('sku', allSkus),
      supabase.from('product_variants').select('sku').in('sku', allSkus),
    ])
    if (pErr || vErr) {
      say(`❌ Gagal membaca database: ${(pErr ?? vErr)!.message}`)
      return finish(1)
    }
    const taken = new Set([...(pRows ?? []), ...(vRows ?? [])].map((r: { sku: string }) => r.sku.toUpperCase()))
    for (const p of products) {
      for (const sku of [p.sku, ...p.variants.map((v) => v.sku)]) {
        if (taken.has(sku)) block({ sku: p.sku, row: p.rows[0], message: `SKU ${sku} sudah ada di database. Produk yang sudah ada diubah lewat OMS, bukan impor.` })
      }
    }
  }

  // 4. Olah foto (juga saat periksa saja: foto rusak/format salah ketahuan sebelum menyimpan)
  const processed = new Map<string, Buffer[]>()
  let before = 0
  let after = 0
  for (const p of products) {
    const files = photos.bySku.get(p.sku)
    if (!files || blocked.has(p.sku)) continue
    const out: Buffer[] = []
    for (const file of files) {
      const bytes = photoEntries.get(file)!.read()
      try {
        const webp = await processPhoto(bytes)
        before += bytes.byteLength
        after += webp.byteLength
        out.push(webp)
      } catch (err) {
        block({ sku: p.sku, message: `Foto ${file} tidak bisa dibaca (${(err as Error).message}). Simpan ulang sebagai JPG/PNG.` })
      }
    }
    processed.set(p.sku, out)
  }

  // 5. Laporan pemeriksaan
  const ready = products.filter((p) => !blocked.has(p.sku))
  const errorCount = issues.length + [...blocked.values()].flat().length
  const problemKeys = new Set([...issues.map((i) => i.sku ?? `baris ${i.row}`), ...blocked.keys()])
  say(`Produk siap: ${ready.length} · bermasalah: ${problemKeys.size}`)
  for (const p of ready) {
    const v = p.variants.length > 0 ? `${p.variants.length} varian` : 'tanpa varian'
    say(`  ✓ ${p.sku} — ${p.name} (${v}, ${photos.bySku.get(p.sku)?.length ?? 0} foto)`)
  }
  if (errorCount > 0) {
    say()
    say(`Kesalahan (${errorCount}) — perbaiki lalu jalankan ulang:`)
    issues.forEach((i) => say(formatIssue(i)))
    for (const list of blocked.values()) list.forEach((i) => say(formatIssue(i)))
  }
  if (photos.warnings.length > 0) {
    say()
    say('Catatan:')
    photos.warnings.forEach((i) => say(formatIssue(i)))
  }
  if (photos.unmatched.length > 0) {
    say()
    say(`Foto yang tidak cocok dengan SKU mana pun (diabaikan): ${photos.unmatched.join(', ')}`)
  }
  if (before > 0) say(`\nUkuran foto: ${kb(before)} → ${kb(after)} setelah dikompres.`)

  if (!SAVE) {
    say()
    say(errorCount === 0 ? 'Semua beres. Jalankan ulang dengan --simpan untuk menyimpan.' : 'Belum ada yang disimpan.')
    return finish(errorCount === 0 ? 0 : 1)
  }
  if (errorCount > 0 && !SKIP_INVALID) {
    say('\n❌ Tidak menyimpan apa pun karena masih ada kesalahan. Perbaiki dulu, atau tambahkan --lewati-salah untuk menyimpan yang siap saja.')
    return finish(1)
  }

  // 6. Simpan
  const { data: wh } = await supabase.from('warehouses').select('id, nama').eq('is_default', true).limit(1).maybeSingle()
  if (!wh) say('\n⚠️ Gudang default tidak ditemukan — baris stok gudang dilewati (stok tetap 0).')

  say()
  let saved = 0
  for (const p of ready) {
    try {
      await saveProduct(supabase, p, processed.get(p.sku) ?? [], wh?.id as string | undefined)
      saved++
      say(`  ✓ tersimpan ${p.sku}`)
    } catch (err) {
      say(`  ✗ gagal ${p.sku}: ${(err as Error).message} (dibatalkan, tidak ada yang tertinggal)`)
    }
  }
  say()
  say(`Selesai: ${saved} dari ${ready.length} produk tersimpan dengan stok 0${SHOW ? '' : ', disembunyikan dari toko'}.`)
  say('Berikutnya: tim gudang mengisi stok di OMS → Kelola Stok Gudang' + (SHOW ? '.' : ', lalu tampilkan produk lewat OMS → Produk → Pulihkan.'))
  return finish(saved === ready.length ? 0 : 1)
}

type Supabase = SupabaseClient

async function saveProduct(supabase: Supabase, p: PlannedProduct, photos: Buffer[], warehouseId: string | undefined) {
  const uploaded: string[] = []
  let productId: string | null = null
  try {
    const urls: string[] = []
    for (const photo of photos) {
      const path = `${FOLDER}/${randomUUID()}.webp`
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, photo, { contentType: 'image/webp', upsert: false, cacheControl: CACHE_SECONDS })
      if (error) throw new Error(`unggah foto: ${error.message}`)
      uploaded.push(path)
      urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    }

    const { data: product, error: pErr } = await supabase
      .from('products')
      .insert({
        name: p.name,
        original_price: p.originalPrice ?? p.price,
        promo_price: p.price,
        image_url: urls[0],
        images: urls,
        category: p.category,
        badge: 'Baru',
        sku: p.sku,
        stock: 0,
        description: p.description,
        archived: !SHOW,
        min_order_qty: p.minOrderQty,
        berat: p.berat,
      } as never)
      .select('id')
      .single()
    if (pErr || !product) throw new Error(`simpan produk: ${pErr?.message ?? 'tanpa id'}`)
    productId = (product as { id: string }).id

    const stockRows: Record<string, unknown>[] = []
    if (p.variants.length > 0) {
      const { data: variants, error: vErr } = await supabase
        .from('product_variants')
        .insert(
          p.variants.map((v) => ({
            product_id: productId,
            nama_varian: v.name,
            sku: v.sku,
            harga: v.price,
            stok: 0,
            is_default: v.isDefault,
          })) as never,
        )
        .select('id')
      if (vErr || !variants) throw new Error(`simpan varian: ${vErr?.message ?? 'tanpa id'}`)
      for (const v of variants as { id: string }[]) stockRows.push({ product_id: productId, variant_id: v.id, warehouse_id: warehouseId, stok: 0 })
    } else {
      stockRows.push({ product_id: productId, warehouse_id: warehouseId, stok: 0 })
    }

    if (warehouseId) {
      const { error: sErr } = await supabase.from('product_stock_per_warehouse').insert(stockRows as never)
      if (sErr) throw new Error(`simpan stok gudang: ${sErr.message}`)
    }
  } catch (err) {
    // Batalkan seluruhnya: varian & baris stok ikut terhapus lewat ON DELETE CASCADE.
    if (productId) await supabase.from('products').delete().eq('id', productId)
    if (uploaded.length > 0) await supabase.storage.from(BUCKET).remove(uploaded)
    throw err
  }
}

function finish(code: number) {
  const dir = statSync(resolve(inputs[0])).isDirectory() ? resolve(inputs[0]) : dirname(resolve(inputs[0]))
  // Cap waktu WIB (format sv-SE = "2026-10-14 12:10") supaya cocok dengan jam di laptop admin.
  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
    .slice(0, 16)
    .replace(/[: ]/g, '-')
  const file = join(dir, `laporan-impor-${stamp}.txt`)
  try {
    writeFileSync(file, lines.join('\n') + '\n', 'utf8')
    console.log(`\nLaporan disimpan: ${file}`)
  } catch {
    // Laporan berkas hanya pelengkap; isi lengkapnya sudah tampil di layar.
  }
  process.exitCode = code
}

main().catch((err) => {
  console.error(`❌ ${(err as Error).message}`)
  process.exitCode = 1
})
