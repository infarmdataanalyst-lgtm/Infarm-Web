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

// === Penjaga panggilan TULIS ke Mengantar ===
//
// Panggilan BACA (cek ongkir, search alamat) gratis dan tak berkonsekuensi. Panggilan TULIS
// (`POST /order` booking kurir, `POST /time` slot pickup) **memotong saldo Mengantar** dan
// menerbitkan resi nyata — pesanan hantu di sistem kurir tak bisa dibatalkan dari sisi kita.
//
// KENAPA PENJAGA INI ADA: pernah terjadi panggilan booking dijalankan dari mesin lokal saat
// verifikasi kontrak API, sehingga saldo terpotong oleh kiriman uji yang bercampur dengan
// pengujian sungguhan — dan tak ada penanda apa pun yang membedakan keduanya di dashboard
// Mengantar. Di sandbox itu kerugian yang bisa ditoleransi. Dengan kunci produksi, itu uang nyata
// dan paket nyata yang akan dijemput kurir.
//
// ATURANNYA: host produksi hanya boleh ditulis dari deployment produksi. Titik.
// Mau menguji booking? Pakai sandbox di lokal, atau lakukan di deployment produksi yang sungguhan.
//
// SENGAJA TANPA JALAN PINTAS (tak ada env "izinkan sekali ini"). Tuas semacam itu selalu berakhir
// menyala di tempat yang salah, dan justru di situlah penjaga ini seharusnya bekerja.
const PRODUCTION_HOST_PATTERN = /(^|\.)app\.mengantar\.com$/i

// true bila host aktif adalah host PRODUKSI Mengantar (bukan sandbox).
function isProductionMengantarHost(host: string): boolean {
  try {
    return PRODUCTION_HOST_PATTERN.test(new URL(host).hostname)
  } catch {
    // Host tak bisa di-parse → anggap produksi. Salah-arah yang aman: menolak menulis lebih baik
    // daripada menulis ke host yang tak kita kenali.
    return true
  }
}

// true HANYA di deployment produksi sungguhan.
//
// `NODE_ENV === 'production'` sendirian TIDAK cukup: `next build`/`next start` lokal dan SELURUH
// preview deployment Vercel juga ber-NODE_ENV production. Preview biasanya mewarisi environment
// variable produksi, jadi tanpa cek `VERCEL_ENV` sebuah preview branch bisa membooking kurir
// sungguhan. VERCEL_ENV tak ada (mis. server lokal / VPS sendiri) → cukup andalkan NODE_ENV.
function isProductionDeployment(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  const vercelEnv = process.env.VERCEL_ENV
  return !vercelEnv || vercelEnv === 'production'
}

export type MengantarWriteHost =
  | { allowed: true; host: string }
  | { allowed: false; host: string; reason: string }

// Host untuk panggilan TULIS Mengantar, atau penolakan beserta alasan yang bisa dibaca admin.
//
// SETIAP titik yang memanggil `POST /order` atau `POST /time` WAJIB lewat fungsi ini dan berhenti
// bila `allowed === false`. Jangan pernah membaca MENGANTAR_BASE_URL langsung untuk panggilan
// tulis — itu memutar balik seluruh penjaga ini.
export function mengantarWriteHost(): MengantarWriteHost {
  const host = mengantarHost()
  if (isProductionMengantarHost(host) && !isProductionDeployment()) {
    return {
      allowed: false,
      host,
      reason:
        'MENGANTAR_BASE_URL menunjuk host PRODUKSI, tapi ini bukan deployment produksi. ' +
        'Panggilan tulis (booking kurir / slot pickup) diblokir agar saldo Mengantar tak terpotong ' +
        'dari lingkungan pengembangan. Pakai https://sandbox.mengantar.com untuk pengujian lokal.',
    }
  }
  return { allowed: true, host }
}
