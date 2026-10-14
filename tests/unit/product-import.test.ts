// tests/unit/product-import.test.ts
// Impor produk massal (scripts/import-produk.ts). Yang mahal kalau salah: produk masuk toko dengan
// harga/berat/kategori keliru, varian tertempel ke produk yang salah, SKU ganda, atau foto produk A
// tampil di produk B — semuanya langsung dilihat pembeli.

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildPlan, IMPORT_COLUMNS, matchPhotos, parseWholeNumber, resolveCategory } from '@/lib/product-import/plan'
import { parseCsv, parseXlsx, readSheet } from '@/lib/product-import/sheet-reader'

const HEADER = [...IMPORT_COLUMNS]
const DESC = 'Benih selada keriting impor, daya tumbuh tinggi, cocok hidroponik.'

// Satu baris data mengikuti urutan IMPORT_COLUMNS.
function row(v: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>): string[] {
  return HEADER.map((c) => v[c] ?? '')
}

const simple = row({
  sku_produk: 'BNH-001',
  nama_produk: 'Benih Selada Keriting',
  kategori: 'Benih Premium',
  deskripsi: DESC,
  berat_gram: '50',
  harga_jual: 'Rp 15.000',
})

describe('parseWholeNumber', () => {
  it('menerima format rupiah umum', () => {
    expect(parseWholeNumber('Rp 25.000')).toBe(25000)
    expect(parseWholeNumber('25,000')).toBe(25000)
    expect(parseWholeNumber('25000')).toBe(25000)
    expect(parseWholeNumber('Rp1.250.000')).toBe(1250000)
  })
  it('menolak pecahan dan teks', () => {
    expect(parseWholeNumber('25,5')).toBeNull()
    expect(parseWholeNumber('dua puluh')).toBeNull()
    expect(parseWholeNumber('')).toBeNull()
  })
})

describe('resolveCategory', () => {
  it('menerima slug maupun label, tanpa peduli huruf besar', () => {
    expect(resolveCategory('benih-premium')).toBe('benih-premium')
    expect(resolveCategory('Media Tanam')).toBe('media-tanam')
    expect(resolveCategory('POT POLYBAG')).toBe('pot-polybag')
    expect(resolveCategory('Bibit')).toBeNull()
  })
})

describe('buildPlan', () => {
  it('produk tanpa varian', () => {
    const { products, issues } = buildPlan([HEADER, simple])
    expect(issues).toEqual([])
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      sku: 'BNH-001',
      category: 'benih-premium',
      price: 15000,
      berat: 50,
      minOrderQty: 1,
      variants: [],
    })
  })

  it('produk bervarian: baris dikelompokkan per sku_produk, harga = varian utama', () => {
    const rows = [
      HEADER,
      row({
        sku_produk: 'PPK-010',
        nama_produk: 'Pupuk NPK Mutiara',
        kategori: 'pupuk-nutrisi',
        deskripsi: 'Pupuk NPK 16-16-16 untuk pertumbuhan daun dan buah yang seimbang.',
        berat_gram: '250',
        harga_coret: '30000',
        nama_varian: '250 gram',
        sku_varian: 'PPK-010-250',
        harga_jual: '12000',
      }),
      row({ sku_produk: 'PPK-010', nama_varian: '500 gram', sku_varian: 'ppk-010-500', harga_jual: '20000', varian_utama: 'ya' }),
    ]
    const { products, issues } = buildPlan(rows)
    expect(issues).toEqual([])
    expect(products[0].variants).toEqual([
      { name: '250 gram', sku: 'PPK-010-250', price: 12000, isDefault: false },
      { name: '500 gram', sku: 'PPK-010-500', price: 20000, isDefault: true },
    ])
    expect(products[0].price).toBe(20000)
    expect(products[0].originalPrice).toBe(30000)
    expect(products[0].rows).toEqual([2, 3])
  })

  it('tanpa varian_utama → varian pertama jadi utama', () => {
    const rows = [
      HEADER,
      row({ ...Object.fromEntries(HEADER.map((c, i) => [c, simple[i]])), nama_varian: 'Kecil', sku_varian: 'BNH-001-K', harga_jual: '10000' }),
      row({ sku_produk: 'BNH-001', nama_varian: 'Besar', sku_varian: 'BNH-001-B', harga_jual: '18000' }),
    ]
    const { products } = buildPlan(rows)
    expect(products[0].variants.map((v) => v.isDefault)).toEqual([true, false])
    expect(products[0].price).toBe(10000)
  })

  it('data produk yang berbeda antar baris varian → kesalahan, produk tidak masuk rencana', () => {
    const rows = [
      HEADER,
      row({ ...Object.fromEntries(HEADER.map((c, i) => [c, simple[i]])), nama_varian: 'A', sku_varian: 'BNH-001-A' }),
      row({ sku_produk: 'BNH-001', berat_gram: '500', nama_varian: 'B', sku_varian: 'BNH-001-B', harga_jual: '9000' }),
    ]
    const { products, issues } = buildPlan(rows)
    expect(products).toHaveLength(0)
    expect(issues[0]).toMatchObject({ row: 3, sku: 'BNH-001' })
    expect(issues[0].message).toContain('berat_gram')
  })

  it('SKU ganda (produk vs varian) di dalam berkas → kesalahan', () => {
    const rows = [
      HEADER,
      simple,
      row({ ...Object.fromEntries(HEADER.map((c, i) => [c, simple[i]])), sku_produk: 'BNH-002', nama_varian: 'X', sku_varian: 'BNH-001' }),
    ]
    const { issues } = buildPlan(rows)
    expect(issues.some((i) => i.message.includes('SKU BNH-001 sudah dipakai di baris 2'))).toBe(true)
  })

  it('aturan OMS ikut berlaku: kategori, berat, deskripsi, harga coret', () => {
    const bad = row({
      sku_produk: 'BNH-003',
      nama_produk: 'Benih Tomat',
      kategori: 'Bibit',
      deskripsi: 'pendek',
      berat_gram: '',
      harga_jual: '20000',
      harga_coret: '15000',
    })
    const { products, issues } = buildPlan([HEADER, bad])
    expect(products).toHaveLength(0)
    const text = issues.map((i) => i.message).join(' | ')
    expect(text).toContain('Kategori "Bibit" tidak dikenal')
    expect(text).toContain('Deskripsi terlalu singkat')
    expect(text).toContain('Berat (gram) wajib diisi')
    expect(text).toContain('Harga asli harus lebih besar dari harga jual')
  })

  it('kolom wajib hilang dari baris judul → berhenti di judul', () => {
    const { products, issues } = buildPlan([['sku_produk', 'nama_produk'], ['A', 'B']])
    expect(products).toEqual([])
    expect(issues.map((i) => i.message)).toContain('Kolom wajib "kategori" tidak ada di baris judul.')
  })

  it('judul boleh berspasi / huruf besar, baris kosong dilewati', () => {
    const header = HEADER.map((h) => h.replace('_', ' ').toUpperCase())
    const { products, issues } = buildPlan([header, HEADER.map(() => ''), simple])
    expect(issues).toEqual([])
    expect(products[0].rows).toEqual([3])
  })
})

describe('matchPhotos', () => {
  it('SKU.jpg = utama, SKU_n = galeri berurutan, huruf besar/kecil diabaikan', () => {
    const files = ['bnh-001_3.png', 'BNH-001.JPG', 'BNH-001_2.webp', 'desktop.ini', 'produk.xlsx'].map((name) => ({ name }))
    const m = matchPhotos(files, ['BNH-001'])
    expect(m.issues).toEqual([])
    expect(m.bySku.get('BNH-001')).toEqual(['BNH-001.JPG', 'BNH-001_2.webp', 'bnh-001_3.png'])
  })

  it('SKU bertanda hubung tidak rancu dengan nomor galeri', () => {
    const m = matchPhotos([{ name: 'BNH-001-2.jpg' }, { name: 'BNH-001.jpg' }], ['BNH-001', 'BNH-001-2'])
    expect(m.bySku.get('BNH-001')).toEqual(['BNH-001.jpg'])
    expect(m.bySku.get('BNH-001-2')).toEqual(['BNH-001-2.jpg'])
  })

  it('tanpa foto → kesalahan; foto yatim → dilaporkan; tanpa foto utama → catatan', () => {
    const m = matchPhotos([{ name: 'PPK-010_2.jpg' }, { name: 'LAIN.jpg' }], ['BNH-001', 'PPK-010'])
    expect(m.issues.map((i) => i.sku)).toEqual(['BNH-001'])
    expect(m.unmatched).toEqual(['LAIN.jpg'])
    expect(m.warnings[0].message).toContain('PPK-010_2.jpg dipakai sebagai foto utama')
    expect(m.bySku.get('PPK-010')).toEqual(['PPK-010_2.jpg'])
  })

  it('dua foto berurutan sama (jpg & png) → kesalahan', () => {
    const m = matchPhotos([{ name: 'BNH-001.jpg' }, { name: 'BNH-001.png' }], ['BNH-001'])
    expect(m.issues[0].message).toContain('Dua foto untuk urutan yang sama')
  })
})

describe('parseCsv', () => {
  it('koma, kutip, koma & baris baru di dalam kutip, BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","baris1\nbaris2"\r\n"kutip ""ganda""",z')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'baris1\nbaris2'],
      ['kutip "ganda"', 'z'],
    ])
  })

  it('titik koma (Excel berlokal Indonesia)', () => {
    expect(parseCsv('a;b\n"Rp 15.000";2')).toEqual([
      ['a', 'b'],
      ['Rp 15.000', '2'],
    ])
  })
})

describe('parseXlsx', () => {
  // .xlsx minimal seperti hasil unduhan Google Drive: shared strings + inline string + angka.
  function makeXlsx(sheetXml: string, shared: string[]): Uint8Array {
    return zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Produk" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
    })
  }

  it('membaca teks bersama, teks inline, angka, entitas XML, dan sel yang dilewati', () => {
    const xml =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Pot &amp; Polybag</t></is></c><c r="B3"><v>15000</v></c></row>'
    const rows = parseXlsx(makeXlsx(xml, ['sku_produk', 'harga_jual']))
    expect(rows).toEqual([['sku_produk', '', 'harga_jual'], [], ['Pot & Polybag', '15000']])
  })

  it('readSheet memilih parser dari ekstensi', () => {
    expect(readSheet('produk.CSV', strToU8('a,b'))).toEqual([['a', 'b']])
    expect(() => readSheet('produk.ods', new Uint8Array())).toThrow('tidak didukung')
  })
})
