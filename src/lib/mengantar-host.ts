// src/lib/mengantar-host.ts
// SATU PINTU host API Mengantar. SERVER ONLY (membaca env non-public MENGANTAR_BASE_URL).
//
// ── Kenapa host cek ongkir tidak boleh hardcode ──
// Sebelum file ini, cek ongkir hardcode ke `app.mengantar.com` (PRODUKSI) sementara booking kurir
// memakai MENGANTAR_BASE_URL (sandbox). Akibatnya harga yang DIKUTIP ke pembeli berasal dari tabel
// tarif produksi, tapi biaya booking mengikuti tabel sandbox — dua angka yang tak akan pernah cocok.
//
// Perbedaannya bukan sedikit. Terukur untuk J&T 1 kg:
//   Surabaya -> Surabaya : produksi Rp4.800   | sandbox Rp61.200
//   Surabaya -> Jakarta  : produksi Rp11.200  | sandbox Rp18.640
//   Jakarta  -> Jakarta  : produksi Rp8.000   | sandbox Rp25.520
// Harga sandbox jelas dummy — di sana intra-Surabaya justru LEBIH MAHAL daripada Surabaya→Jakarta,
// yang mustahil pada tarif nyata.
//
// Dengan host tunggal ini, cek ongkir & booking selalu berada di lingkungan yang SAMA:
//   - lokal/pengujian : MENGANTAR_BASE_URL = https://sandbox.mengantar.com
//   - production      : MENGANTAR_BASE_URL = https://app.mengantar.com
// Beralih lingkungan = ganti satu env var + redeploy. TIDAK ada perubahan kode.

// Host produksi. Dipakai bila MENGANTAR_BASE_URL belum di-set, supaya cek ongkir tak pernah mati
// hanya karena env belum lengkap — dan agar nilai bawaannya adalah yang benar untuk pembeli nyata.
const DEFAULT_MENGANTAR_HOST = 'https://app.mengantar.com'

// Host aktif, tanpa garis miring di akhir.
export function mengantarHost(): string {
  const base = process.env.MENGANTAR_BASE_URL?.trim()
  return (base || DEFAULT_MENGANTAR_HOST).replace(/\/+$/, '')
}

// URL cek ongkir (allEstimatePublic). Endpoint publik — tak butuh API key.
// Kedua host (produksi & sandbox) sudah diverifikasi melayani path ini.
export function mengantarEstimateUrl(): string {
  return `${mengantarHost()}/api/order/allEstimatePublic`
}
