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
//
// Perlindungan: rate limit per-IP (lihat @/lib/rate-limit) supaya proxy ini tidak dipakai bot
// sebagai relay gratis ke Mengantar / membebani server tanpa niat checkout. Batasnya longgar
// terhadap pemakaian normal (UI sudah debounce 500ms + minimal 3 karakter).

import { NextResponse } from 'next/server'
import { mengantarAddressSearchUrl } from '@/lib/mengantar-host'
import { RATE_LIMITS, enforceRateLimit, getClientIp } from '@/lib/rate-limit'

// Host & API key diurus mengantarAddressSearchUrl() — lihat catatan sejarahnya di lib/mengantar-host.ts.
// Ringkasnya: sampai 2026-09-07 URL-nya dipaku ke host produksi dengan segmen literal `test`, yang
// dikira penanda versi padahal menempati posisi API KEY. Mengantar mencabut kunci demo itu dan
// checkout produksi ikut mati. Kini pencarian alamat mengikuti MENGANTAR_BASE_URL seperti panggilan
// Mengantar lainnya, memakai kunci Infarm sendiri — lokal/pengujian otomatis ke sandbox.
//
// ⚠️ URL hasilnya memuat API key sebagai segmen path. JANGAN pernah memasukkannya ke log,
// pesan error, atau respons.

// Batas panjang keyword (anti payload sampah / relay abuse)
const MAX_KEYWORD_LENGTH = 100

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
  const limited = enforceRateLimit(
    `mengantar-address:ip:${getClientIp(request)}`,
    RATE_LIMITS.MENGANTAR_IP,
  )
  if (limited) return limited

  const { searchParams } = new URL(request.url)
  const keyword = (searchParams.get('keyword') ?? '').trim()

  // Sejalan dengan UI (fetch baru jalan setelah ≥3 karakter)
  if (keyword.length < 3) {
    return NextResponse.json({ error: 'Keyword minimal 3 karakter.' }, { status: 400 })
  }
  // Batas atas: nama kelurahan terpanjang pun jauh di bawah ini — tolak payload besar sebelum
  // diteruskan ke upstream (rekomendasi R-4 audit 2026-07-08).
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return NextResponse.json({ error: 'Keyword terlalu panjang.' }, { status: 400 })
  }

  // Kunci belum di-set → 500, BUKAN 502. Dibedakan supaya salah konfigurasi tak lagi menyamar
  // sebagai gangguan upstream: persis kebingungan itu yang membuat pencabutan kunci `test`
  // tanggal 7 Sep 2026 tampak seperti "server Mengantar down".
  const endpoint = mengantarAddressSearchUrl(keyword)
  if (!endpoint.ok) {
    console.error(`[address-search] konfigurasi belum lengkap: ${endpoint.reason}`)
    return NextResponse.json({ error: 'Pencarian alamat belum dikonfigurasi.' }, { status: 500 })
  }

  try {
    const res = await fetch(endpoint.url)
    // Status upstream dicatat agar kegagalan berikutnya bisa dibedakan (403 = kunci ditolak,
    // 5xx = gangguan Mengantar). URL-nya TIDAK ikut dicatat — memuat API key.
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
  } catch (error) {
    // Aman dicatat: pesannya hanya "Upstream <status>" / galat jaringan, tanpa URL ber-API-key.
    console.error(
      `[address-search] gagal: ${error instanceof Error ? error.message : 'tidak diketahui'}`,
    )
    return NextResponse.json({ error: 'Gagal mencari alamat.' }, { status: 502 })
  }
}
