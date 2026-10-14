// src/lib/product-import/plan.ts
// Mengubah baris spreadsheet impor produk menjadi rencana impor yang sudah tervalidasi: produk,
// variannya, dan foto-fotonya — beserta daftar kesalahan yang bisa diteruskan apa adanya ke tim
// sales. Fungsi MURNI (tanpa jaringan/berkas), jadi seluruh aturan bisa diuji unit.
//
// ── Bentuk spreadsheet (satu baris per produk ATAU per varian) ──
//   sku_produk | nama_produk | kategori | deskripsi | berat_gram | min_beli | harga_coret |
//   harga_jual | nama_varian | sku_varian | varian_utama
//
// - Produk TANPA varian: satu baris, kolom varian dikosongkan.
// - Produk BERVARIAN: satu baris per varian dengan sku_produk yang SAMA. Data produk (nama,
//   kategori, deskripsi, berat, min_beli, harga_coret) cukup diisi di baris pertamanya; bila baris
//   berikutnya ikut diisi, isinya wajib sama — beda isi hampir selalu salah salin.
// - Harga produk bervarian = harga_jual varian utama (kolom varian_utama "ya"; kosong → varian
//   pertama), sama dengan yang dilakukan OMS.
// - Stok TIDAK ada di spreadsheet: semua produk masuk dengan stok 0 dan diisi tim gudang lewat
//   OMS → Kelola Stok Gudang (keputusan pemilik 2026-10-14).
//
// ── Foto ──
// Nama berkas mengikuti SKU produk: `SKU.jpg` = foto utama, `SKU_2.jpg`, `SKU_3.jpg`, … = galeri.
// Garis bawah dipilih sebagai pemisah karena SKU hanya boleh huruf kapital, angka, dan tanda
// hubung (SKU_REGEX) — `BNH-001-2.jpg` tak bisa dibedakan dari foto produk ber-SKU `BNH-001-2`,
// sedangkan `BNH-001_2.jpg` tak mungkin rancu.
//
// Aturan nilai mengikuti form OMS (lib/product-validation.ts) supaya produk hasil impor tak bisa
// berbeda dari produk yang dibuat lewat OMS.

import { PRODUCT_CATEGORIES } from '@/lib/data/categories'
import {
  MAX_PRODUCT_IMAGES,
  validateBerat,
  validateDescription,
  validateMinOrderQty,
  validateName,
  validateOriginalPrice,
  validatePrice,
  validateSkuFormat,
} from '@/lib/product-validation'
import type { ProductCategory } from '@/types/product'

export const IMPORT_COLUMNS = [
  'sku_produk',
  'nama_produk',
  'kategori',
  'deskripsi',
  'berat_gram',
  'min_beli',
  'harga_coret',
  'harga_jual',
  'nama_varian',
  'sku_varian',
  'varian_utama',
] as const
type Column = (typeof IMPORT_COLUMNS)[number]

const REQUIRED_COLUMNS: Column[] = ['sku_produk', 'nama_produk', 'kategori', 'deskripsi', 'berat_gram', 'harga_jual']

// Kolom yang menjadi milik PRODUK (bukan varian) — wajib sama di setiap baris produk yang sama.
const PRODUCT_LEVEL: Column[] = ['nama_produk', 'kategori', 'deskripsi', 'berat_gram', 'min_beli', 'harga_coret']

export const VARIANT_NAME_MAX = 100
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

export type ImportIssue = {
  row?: number // nomor baris spreadsheet (baris judul = 1)
  sku?: string
  message: string
}

export type PlannedVariant = { name: string; sku: string; price: number; isDefault: boolean }

export type PlannedProduct = {
  sku: string
  name: string
  category: ProductCategory
  description: string
  berat: number
  minOrderQty: number
  price: number // harga jual (= promo_price)
  originalPrice?: number // harga coret, bila diisi
  variants: PlannedVariant[]
  rows: number[]
}

// === Angka ===

// "Rp 25.000", "25.000", "25,000", "25000" → 25000. Pecahan ("25,5") dan teks lain → null.
// Google Sheets mengekspor nilai SEBAGAIMANA TAMPIL, jadi format mata uang ikut terbawa ke CSV.
export function parseWholeNumber(raw: string): number | null {
  const s = raw.replace(/rp\.?/gi, '').replace(/\s/g, '')
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  return null
}

// === Kategori ===

function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

// Menerima slug ("benih-premium") maupun label ("Benih Premium"), tanpa peduli huruf besar.
export function resolveCategory(raw: string): ProductCategory | null {
  const key = normalizeLabel(raw)
  const found = PRODUCT_CATEGORIES.find((c) => c.slug === key || normalizeLabel(c.label) === key)
  return found ? (found.slug as ProductCategory) : null
}

// === Header ===

function headerKey(raw: string): string {
  return raw.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export type HeaderMap = Partial<Record<Column, number>>

export function mapHeader(header: string[]): { map: HeaderMap; issues: ImportIssue[] } {
  const map: HeaderMap = {}
  const issues: ImportIssue[] = []
  header.forEach((cell, i) => {
    const key = headerKey(cell)
    if ((IMPORT_COLUMNS as readonly string[]).includes(key)) {
      if (map[key as Column] !== undefined) issues.push({ row: 1, message: `Kolom "${key}" muncul dua kali.` })
      else map[key as Column] = i
    }
  })
  for (const col of REQUIRED_COLUMNS) {
    if (map[col] === undefined) issues.push({ row: 1, message: `Kolom wajib "${col}" tidak ada di baris judul.` })
  }
  return { map, issues }
}

// === Rencana dari baris ===

type RawRow = { row: number; get: (c: Column) => string }

function isYes(raw: string): boolean {
  return ['ya', 'y', 'yes', 'true', '1', 'utama', 'x', 'v', '✓'].includes(raw.trim().toLowerCase())
}

export function buildPlan(rows: string[][]): { products: PlannedProduct[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  if (rows.length === 0) return { products: [], issues: [{ message: 'Spreadsheet kosong.' }] }

  const { map, issues: headerIssues } = mapHeader(rows[0])
  if (headerIssues.length > 0) return { products: [], issues: headerIssues }

  // Kelompokkan baris per sku_produk, urutan kemunculan dipertahankan.
  const groups = new Map<string, RawRow[]>()
  rows.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2
    const get = (c: Column) => (map[c] === undefined ? '' : (cells[map[c]!] ?? '').trim())
    if (IMPORT_COLUMNS.every((c) => get(c) === '')) return // baris kosong
    const sku = get('sku_produk').toUpperCase()
    if (!sku) {
      issues.push({ row: rowNumber, message: 'sku_produk kosong.' })
      return
    }
    const list = groups.get(sku) ?? []
    list.push({ row: rowNumber, get })
    groups.set(sku, list)
  })

  const products: PlannedProduct[] = []
  const seenSkus = new Map<string, number>() // SKU (produk & varian) → baris pertama pemakainya

  const claimSku = (sku: string, row: number): boolean => {
    const prev = seenSkus.get(sku)
    if (prev !== undefined) {
      issues.push({ row, sku, message: `SKU ${sku} sudah dipakai di baris ${prev}. SKU produk dan varian harus unik.` })
      return false
    }
    seenSkus.set(sku, row)
    return true
  }

  for (const [sku, group] of groups) {
    const first = group[0]
    const before = issues.length
    const fail = (message: string, row = first.row) => issues.push({ row, sku, message })

    const skuErr = validateSkuFormat(sku)
    if (skuErr) fail(`${skuErr} (${sku}).`)
    claimSku(sku, first.row)

    // Data level produk: diambil dari baris pertama; baris lain boleh kosong, tapi bila diisi harus sama.
    for (const row of group.slice(1)) {
      for (const col of PRODUCT_LEVEL) {
        const v = row.get(col)
        if (v !== '' && v !== first.get(col)) {
          fail(`Kolom ${col} berbeda dari baris ${first.row} untuk produk yang sama ("${v}" vs "${first.get(col)}").`, row.row)
        }
      }
    }

    const name = first.get('nama_produk')
    const nameErr = validateName(name)
    if (nameErr) fail(nameErr + '.')

    const category = resolveCategory(first.get('kategori'))
    if (!category) {
      const options = PRODUCT_CATEGORIES.map((c) => c.label).join(', ')
      fail(`Kategori "${first.get('kategori')}" tidak dikenal. Pilihan: ${options}.`)
    }

    const description = first.get('deskripsi')
    const descErr = validateDescription(description)
    if (descErr) fail(descErr + '.')

    const berat = parseWholeNumber(first.get('berat_gram'))
    const beratErr = berat === null ? 'Berat (gram) wajib diisi angka bulat' : validateBerat(berat)
    if (beratErr) fail(beratErr + '.')

    const minRaw = first.get('min_beli')
    const minOrderQty = minRaw === '' ? 1 : parseWholeNumber(minRaw)
    const minErr = minOrderQty === null ? 'Minimal pembelian harus angka bulat' : validateMinOrderQty(minOrderQty)
    if (minErr) fail(minErr + '.')

    // Varian
    const variantRows = group.filter((r) => r.get('nama_varian') !== '' || r.get('sku_varian') !== '')
    const variants: PlannedVariant[] = []
    let price: number | null = null

    if (variantRows.length > 0 && variantRows.length < group.length) {
      fail('Produk bervarian: setiap barisnya wajib mengisi nama_varian dan sku_varian.')
    }

    if (variantRows.length === 0) {
      if (group.length > 1) fail(`sku_produk ${sku} muncul di ${group.length} baris tanpa varian. Isi nama_varian & sku_varian, atau hapus baris ganda.`)
      price = parseWholeNumber(first.get('harga_jual'))
      const priceErr = price === null ? 'Harga jual wajib diisi angka bulat' : validatePrice(price)
      if (priceErr) fail(priceErr + '.')
    } else {
      const defaults = variantRows.filter((r) => isYes(r.get('varian_utama')))
      if (defaults.length > 1) fail(`Varian utama lebih dari satu (baris ${defaults.map((r) => r.row).join(', ')}). Pilih satu.`)
      const defaultRow = defaults[0] ?? variantRows[0]

      for (const r of variantRows) {
        const vName = r.get('nama_varian')
        const vSku = r.get('sku_varian').toUpperCase()
        if (!vName) fail('nama_varian kosong.', r.row)
        else if (vName.length > VARIANT_NAME_MAX) fail(`nama_varian maksimal ${VARIANT_NAME_MAX} karakter.`, r.row)
        if (!vSku) fail('sku_varian kosong.', r.row)
        else {
          const vSkuErr = validateSkuFormat(vSku)
          if (vSkuErr) fail(`${vSkuErr} (${vSku}).`, r.row)
          claimSku(vSku, r.row)
        }
        const vPrice = parseWholeNumber(r.get('harga_jual'))
        const vPriceErr = vPrice === null ? 'Harga jual varian wajib diisi angka bulat' : validatePrice(vPrice)
        if (vPriceErr) fail(vPriceErr + '.', r.row)
        variants.push({ name: vName, sku: vSku, price: vPrice ?? 0, isDefault: r === defaultRow })
      }
      price = parseWholeNumber(defaultRow.get('harga_jual'))
    }

    const origRaw = first.get('harga_coret')
    let originalPrice: number | undefined
    if (origRaw !== '') {
      const parsed = parseWholeNumber(origRaw)
      const origErr = parsed === null ? 'Harga coret harus angka bulat' : validateOriginalPrice(parsed, price ?? '')
      if (origErr) fail(origErr + '.')
      else originalPrice = parsed!
    }

    if (issues.length === before && category && berat !== null && minOrderQty !== null && price !== null) {
      products.push({
        sku,
        name,
        category,
        description,
        berat,
        minOrderQty,
        price,
        originalPrice,
        variants,
        rows: group.map((r) => r.row),
      })
    }
  }

  return { products, issues }
}

// === Foto ===

export type PhotoFile = { name: string } // nama berkas TANPA folder

export type PhotoMatch = {
  bySku: Map<string, string[]> // SKU → nama berkas, urut: utama, _2, _3, …
  issues: ImportIssue[] // menggagalkan produk
  warnings: ImportIssue[] // hanya diberitahukan
  unmatched: string[] // berkas foto yang tak cocok dengan SKU mana pun
}

// Berkas yang bukan foto produk (sampah sistem, spreadsheet, dsb.) diabaikan tanpa peringatan.
export function isPhotoName(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~$')) return false
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return PHOTO_EXTENSIONS.includes(ext)
}

export function matchPhotos(files: PhotoFile[], productSkus: string[]): PhotoMatch {
  const skus = new Set(productSkus.map((s) => s.toUpperCase()))
  const slots = new Map<string, Map<number, string>>() // SKU → (urutan → berkas)
  const issues: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  const unmatched: string[] = []

  for (const file of files) {
    if (!isPhotoName(file.name)) continue
    const stem = file.name.slice(0, file.name.lastIndexOf('.')).trim().toUpperCase()
    const m = stem.match(/^(.+?)_(\d+)$/)
    const sku = m ? m[1] : stem
    const order = m ? Number(m[2]) : 1
    if (!skus.has(sku)) {
      unmatched.push(file.name)
      continue
    }
    const map = slots.get(sku) ?? new Map<number, string>()
    const existing = map.get(order)
    if (existing) {
      issues.push({ sku, message: `Dua foto untuk urutan yang sama: ${existing} dan ${file.name}. Hapus salah satu.` })
      continue
    }
    map.set(order, file.name)
    slots.set(sku, map)
  }

  const bySku = new Map<string, string[]>()
  for (const sku of skus) {
    const map = slots.get(sku)
    if (!map || map.size === 0) {
      issues.push({ sku, message: `Tidak ada foto. Beri nama berkas ${sku}.jpg (foto utama) dan ${sku}_2.jpg dst. (galeri).` })
      continue
    }
    const ordered = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name)
    if (ordered.length > MAX_PRODUCT_IMAGES) {
      issues.push({ sku, message: `Foto ${ordered.length} berkas, maksimal ${MAX_PRODUCT_IMAGES}.` })
      continue
    }
    // Tanpa SKU.jpg, foto galeri terkecil naik menjadi foto utama — tak perlu menggagalkan produk,
    // cukup diberitahukan supaya tim sales tahu foto mana yang tampil di katalog.
    if (!map.has(1)) {
      warnings.push({ sku, message: `Foto utama ${sku}.jpg tidak ada; ${ordered[0]} dipakai sebagai foto utama.` })
    }
    bySku.set(sku, ordered)
  }

  return { bySku, issues, warnings, unmatched }
}
