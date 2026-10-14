// src/lib/product-import/sheet-reader.ts
// Membaca spreadsheet impor produk menjadi baris-baris teks: CSV (koma atau titik koma) dan
// Excel .xlsx. Dipakai skrip scripts/import-produk.ts — TIDAK pernah berjalan di Vercel.
//
// ── Kenapa .xlsx dibaca sendiri, bukan lewat pustaka Excel ──
// Google Drive mengubah Google Sheets menjadi .xlsx saat sebuah folder diunduh sebagai ZIP, jadi
// .xlsx harus bisa dibaca. Pustaka Excel populer membawa advisory keamanan yang ikut diperiksa CI
// (npm audit). Format .xlsx sendiri hanyalah ZIP berisi XML; yang dibutuhkan di sini cuma teks sel
// lembar pertama, dan itu cukup dibaca dengan fflate (sudah dipakai untuk ZIP foto).
//
// Yang SENGAJA tidak didukung: rumus (yang dibaca nilai tersimpannya), sel gabungan, dan format
// tanggal — kolom template impor semuanya teks atau angka.

import { strFromU8, unzipSync } from 'fflate'

export type SheetRows = string[][]

// === CSV ===

// Pemisah ditebak dari baris pertama: Excel berlokal Indonesia menyimpan CSV dengan titik koma,
// Google Sheets dengan koma. Yang lebih banyak muncul di luar tanda kutip yang menang.
function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  let inQuotes = false
  let commas = 0
  let semis = 0
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch === ',') commas++
    else if (!inQuotes && ch === ';') semis++
  }
  return semis > commas ? ';' : ','
}

// Parser CSV (RFC 4180): tanda kutip ganda, pemisah & baris baru di dalam kutip, "" = kutip literal.
export function parseCsv(input: string): SheetRows {
  const text = input.replace(/^﻿/, '') // BOM dari Excel
  const delimiter = detectDelimiter(text)
  const rows: SheetRows = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// === XLSX (lembar pertama) ===

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// Isi teks sebuah <si> / <is>: gabungan semua <t>, termasuk potongan rich text (<r><t>…</t></r>).
function joinTextRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1])
  return out
}

// "C12" → indeks kolom 2 (A=0).
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// Mencari berkas XML lembar PERTAMA menurut urutan di workbook.xml (bukan nama berkas sheet1.xml:
// lembar yang digeser urutannya tetap menyimpan nama berkas lamanya).
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : ''
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  if (firstSheet) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0]
      if (tag.includes(`Id="${firstSheet}"`)) {
        const target = tag.match(/Target="([^"]+)"/)?.[1]
        if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

export function parseXlsx(bytes: Uint8Array): SheetRows {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('Berkas Excel rusak atau bukan .xlsx.')
  }

  const shared: string[] = []
  if (files['xl/sharedStrings.xml']) {
    const xml = strFromU8(files['xl/sharedStrings.xml'])
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(joinTextRuns(m[1]))
  }

  const sheetPath = firstSheetPath(files)
  const sheetBytes = files[sheetPath]
  if (!sheetBytes) throw new Error('Lembar pertama Excel tidak ditemukan.')
  const sheet = strFromU8(sheetBytes)

  const rows: SheetRows = []
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1)
    const cells: string[] = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1]
      const body = cellMatch[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? ''
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = joinTextRuns(body)
      else if (raw !== undefined) value = decodeXml(raw)
      cells[ref ? columnIndex(ref) : cells.length] = value
    }
    // Baris kosong di tengah tetap dipertahankan posisinya supaya nomor baris di laporan cocok
    // dengan yang dilihat tim sales di spreadsheet.
    while (rows.length < rowNumber - 1) rows.push([])
    rows.push(Array.from(cells, (c) => c ?? ''))
  }
  return rows
}

// Pintu tunggal: pilih parser dari ekstensi nama berkas.
export function readSheet(fileName: string, bytes: Uint8Array): SheetRows {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx')) return parseXlsx(bytes)
  if (lower.endsWith('.csv')) return parseCsv(new TextDecoder('utf-8').decode(bytes))
  throw new Error(`Format spreadsheet tidak didukung: ${fileName} (pakai .csv atau .xlsx).`)
}
