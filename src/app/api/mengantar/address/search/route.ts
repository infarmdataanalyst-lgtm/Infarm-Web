// src/app/api/mengantar/address/search/route.ts
// Proxy server untuk pencarian alamat Mengantar (dipakai search alamat di checkout).
//   GET /api/mengantar/address/search?keyword=...
//
// Kenapa diproksi (bukan fetch langsung dari browser): endpoint Mengantar tidak mengirim
// header CORS, jadi respons-nya akan diblokir browser bila di-fetch lintas-origin dari client.
// Route handler ini (BUKAN server action) meneruskan request dari origin kita sendiri,
// lalu meringkas respons ke field yang dipakai checkout (termasuk _id untuk cek ongkir).
//
// Catatan: endpoint Mengantar versi /test tidak memvalidasi API key, jadi tidak ada secret di sini.

import { NextResponse } from 'next/server'

const MENGANTAR_SEARCH_URL = 'https://app.mengantar.com/api/public/test/address/search'

// Bentuk satu alamat dari Mengantar (hanya field yang dipakai checkout)
type MengantarAddressRow = {
  _id: string
  PROVINCE_NAME: string
  CITY_NAME: string
  DISTRICT_NAME: string
  SUBDISTRICT_NAME: string
  ZIP_CODE: string
}
type MengantarSearchResponse = { success?: boolean; data?: MengantarAddressRow[] }

// GET: teruskan keyword ke Mengantar, kembalikan { data: [...] } yang sudah diringkas.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = (searchParams.get('keyword') ?? '').trim()

  // Sejalan dengan UI (fetch baru jalan setelah ≥3 karakter)
  if (keyword.length < 3) {
    return NextResponse.json({ error: 'Keyword minimal 3 karakter.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${MENGANTAR_SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`)
    if (!res.ok) throw new Error(`Upstream ${res.status}`)
    const json = (await res.json()) as MengantarSearchResponse

    // Hanya teruskan field yang dipakai checkout agar payload kecil & stabil
    const data = (json.data ?? []).map((row) => ({
      _id: row._id,
      PROVINCE_NAME: row.PROVINCE_NAME,
      CITY_NAME: row.CITY_NAME,
      DISTRICT_NAME: row.DISTRICT_NAME,
      SUBDISTRICT_NAME: row.SUBDISTRICT_NAME,
      ZIP_CODE: row.ZIP_CODE,
    }))

    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Gagal mencari alamat.' }, { status: 502 })
  }
}
