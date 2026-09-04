// src/lib/rate-limit.ts
// Rate limiter in-memory sederhana (best-effort, per-instance) untuk endpoint publik yang rawan
// disalahgunakan bot: lacak/batalkan/review pesanan by no_telepon, proxy Mengantar (alamat & ongkir),
// pembuatan order, dan submit ulasan. Pola sama seperti limiter di /api/oms/login.
//
// Catatan arsitektur: in-memory per-instance — di lingkungan serverless multi-instance/multi-region
// ini BUKAN pengganti rate limit terpusat (tabel Supabase / Redis), tapi jauh lebih baik daripada
// tidak ada sama sekali (menutup temuan K-1 audit keamanan 2026-07-24). Semua ambang batas
// terkumpul di `RATE_LIMITS` agar mudah di-tuning tanpa menyentuh route handler.

import { NextResponse } from 'next/server'

// Satu aturan pembatasan: maksimal `max` percobaan dalam jendela `windowMs`
export type RateRule = { max: number; windowMs: number }

const MINUTE = 60_000

// === Ambang Batas Terpusat ===
// Ubah angka di sini bila perlu di-tuning (mis. terlalu ketat untuk user normal).
export const RATE_LIMITS = {
  // Endpoint BACA by no_telepon (track-by-phone, verify-cancel, reviewable-by-phone)
  PHONE_LOOKUP_IP: { max: 20, windowMs: 15 * MINUTE }, // throttle umum per sumber
  PHONE_LOOKUP_PHONE: { max: 15, windowMs: 60 * MINUTE }, // anti brute-force tertarget 1 nomor
  // Kombinasi IP + nomor yang dicoba. Hanya percobaan GAGAL (nomor tanpa pesanan / tidak cocok)
  // yang dihitung → user normal yang mengulang pencarian nomornya sendiri tidak pernah kena.
  PHONE_LOOKUP_IP_PHONE_MISS: { max: 5, windowMs: 15 * MINUTE },

  // Endpoint BACA by email (track-by-email). Ambangnya SENGAJA sama persis dengan PHONE_LOOKUP_*
  // karena ancamannya identik: menebak identitas orang lain untuk mengintip pesanannya. Dibuat
  // sebagai konstanta terpisah, bukan memakai ulang yang di atas, supaya keduanya bisa disetel
  // sendiri-sendiri nanti — email jauh lebih mudah ditebak daripada nomor telepon (alamat kerja
  // berpola nama@perusahaan.com), jadi bila ada penyalahgunaan, angka di sinilah yang diturunkan
  // tanpa ikut memperketat jalur telepon.
  EMAIL_LOOKUP_IP: { max: 20, windowMs: 15 * MINUTE }, // throttle umum per sumber
  EMAIL_LOOKUP_EMAIL: { max: 15, windowMs: 60 * MINUTE }, // anti brute-force tertarget 1 email
  // Kombinasi IP + email yang dicoba. Sama seperti versi telepon: HANYA percobaan GAGAL (email
  // tanpa pesanan) yang dihitung, sehingga pemilik email yang me-reload halamannya sendiri tidak
  // pernah tersentuh limit ini, sementara penebak berhenti di 5 percobaan meleset.
  EMAIL_LOOKUP_IP_EMAIL_MISS: { max: 5, windowMs: 15 * MINUTE },

  // Endpoint TULIS/destruktif by no_telepon (cancel-by-phone)
  PHONE_WRITE_IP: { max: 8, windowMs: 15 * MINUTE },
  PHONE_WRITE_PHONE: { max: 5, windowMs: 60 * MINUTE },

  // === Konfirmasi kepemilikan pembatalan — DIKUNCI PADA PESANAN, BUKAN PADA TEBAKAN ===
  //
  // Menutup SEC-038. Versi lama mengunci ember pada no_telepon yang sedang DICOBA
  // (`verify-cancel:phone:{nomor}` dan `verify-cancel:miss:{ip}:{nomor}`). Penebak, menurut
  // definisinya, mengganti nomor tiap percobaan — jadi ia selalu mendapat ember baru dan kedua
  // lapis itu tak pernah menyentuhnya. Terukur: enam percobaan dengan nomor BERBEDA lolos
  // seluruhnya, sementara enam percobaan dengan nomor SAMA berhenti di 429 pada percobaan keenam.
  // Pembatasnya bekerja persis untuk pola yang TIDAK dipakai penyerang.
  //
  // Kuncinya kini NOMOR INVOICE yang sedang diserang. Itulah yang tetap sama sepanjang serangan,
  // sehingga percobaan ke-N benar-benar terhitung sebagai percobaan ke-N.
  //
  // Angkanya melawan ruang tebak yang sebenarnya: /track menyamarkan telepon menjadi 0812****7890,
  // jadi yang perlu ditebak hanya 4 digit tengah — 10.000 kemungkinan. Dengan 10 per jam per
  // pesanan, menyapu seluruh ruang itu butuh ~42 hari, jauh melewati masa sebuah pesanan masih
  // berstatus boleh dibatalkan.
  //
  // HANYA percobaan GAGAL yang dihitung, jadi pemilik sah yang mengetik nomornya sendiri dengan
  // benar tak pernah menghabiskan jatah. TRADEOFF YANG DISENGAJA: penyerang bisa membakar jatah
  // sebuah pesanan untuk menghalangi pemiliknya membatalkan lewat halaman ini selama satu jam.
  // Itu diterima karena jalur tautan bertoken (/order-cancellation) tak ikut terpengaruh, dan
  // menukar "pesanan orang lain bisa dibatalkan" dengan "pembatalan mandiri tertunda satu jam"
  // jelas menguntungkan.
  CANCEL_VERIFY_ORDER_MISS: { max: 10, windowMs: 60 * MINUTE },

  // Endpoint TULIS by email (reviews/create-by-email). Angkanya sama dengan PHONE_WRITE_PHONE
  // karena ancamannya sebangun, tapi dibuat konstanta sendiri dengan alasan yang sama seperti
  // EMAIL_LOOKUP_*: email lebih mudah ditebak daripada nomor telepon, jadi bila suatu saat perlu
  // diperketat, yang diturunkan cukup angka di sini tanpa ikut mengetatkan jalur telepon.
  //
  // Tak ada pasangan EMAIL_WRITE_IP: lapis per-IP untuk submit ulasan sudah dipegang
  // REVIEW_CREATE_IP, yang sengaja dipakai bersama oleh KETIGA endpoint submit ulasan supaya bot
  // tak bisa memecah spamnya ke beberapa endpoint untuk mendapat jatah berkali lipat.
  EMAIL_WRITE_EMAIL: { max: 5, windowMs: 60 * MINUTE },

  // Proxy Mengantar (search alamat & cek ongkir) — cegah dipakai bot sebagai relay gratis.
  //
  // Dinaikkan 20 → 40 (2026-08-24) setelah pengukuran langsung ke app.mengantar.com:
  // 30 request beruntun berjeda 200ms (~167 req/menit dari satu IP) dijawab 200 semua, tanpa
  // satu pun 429 dan tanpa pelambatan (132–172 ms stabil). Lihat scripts/mengantar-test/rate-limit.ts.
  //
  // Angka 20 membatasi PEMBELI, bukan Mengantar. Combobox alamat memakai debounce 500ms + minimal
  // 3 karakter, jadi satu pencarian wajar = 3–6 request; pembeli yang salah ketik lalu mengoreksi
  // alamat bisa menyentuh 20 dalam satu sesi checkout dan pencarian alamatnya mati semenit tepat
  // saat hendak bayar. 40 memberi ruang itu dan tetap tak berguna bagi scraper (butuh ribuan),
  // serta masih jauh di bawah ambang Mengantar yang terukur.
  MENGANTAR_IP: { max: 40, windowMs: 1 * MINUTE },

  // Checkout / buat pesanan — cegah order spam
  ORDER_CREATE_IP: { max: 3, windowMs: 1 * MINUTE },

  // === Baca satu pesanan by nomor invoice (orders/get, dipakai form ulasan) ===
  // Nomor invoice berpola INV-YYYYMMDD-xxxx, jadi ruang tebakannya kecil untuk satu hari tertentu.
  // Tanpa pembatas, seluruh ruang satu hari bisa disapu dari satu IP dalam hitungan menit.
  ORDER_GET_IP: { max: 30, windowMs: 15 * MINUTE },
  // Lapis anti-enumerasi: HANYA tebakan MELESET (invoice tak ditemukan) yang dihitung. Pembeli sah
  // datang dengan nomor yang benar dan boleh memuat ulang halaman ulasannya sesering apa pun tanpa
  // pernah menyentuh limit ini, sementara penyapu — yang menurut definisinya hampir selalu meleset —
  // berhenti setelah 10 percobaan gagal. Menutup temuan SEC-007.
  ORDER_GET_IP_MISS: { max: 10, windowMs: 15 * MINUTE },

  // Submit ulasan — cegah spam review
  REVIEW_CREATE_IP: { max: 3, windowMs: 10 * MINUTE },

  // === Login OMS ===
  // HANYA percobaan GAGAL yang dihitung (pola sama seperti PHONE_LOOKUP_IP_PHONE_MISS). Admin yang
  // kredensialnya benar tak pernah menghabiskan jatah, berapa kali pun ia keluar-masuk — jadi
  // ambangnya bisa dibuat ketat tanpa mengganggu pemakaian wajar.
  OMS_LOGIN_IP: { max: 10, windowMs: 15 * MINUTE }, // throttle umum per sumber
  OMS_LOGIN_IP_USER: { max: 5, windowMs: 15 * MINUTE }, // satu penyerang menebak satu akun
  // Per AKUN, LINTAS IP. Ini yang menutup brute-force terdistribusi: tanpa lapis ini, penyerang
  // cukup mengganti IP (atau memakai botnet) untuk mendapat jatah 5 tebakan baru berulang kali,
  // sehingga dua lapis di atas tak membatasi apa pun bagi lawan yang serius.
  //
  // Jendelanya sengaja panjang (1 jam) dan angkanya longgar: yang dilawan adalah ribuan tebakan,
  // bukan admin yang lupa kata sandinya beberapa kali dari kantor dan rumah. Sengaja TIDAK memakai
  // penguncian akun permanen — itu justru membuka penolakan layanan, siapa pun bisa mengunci akun
  // admin hanya dengan mengetik kata sandi salah berulang kali.
  OMS_LOGIN_USER: { max: 20, windowMs: 60 * MINUTE },

  // Pembuatan Virtual Account (Xendit). Lebih longgar dari ORDER_CREATE_IP karena pembeli yang sah
  // memang bisa mencoba beberapa bank berbeda untuk satu pesanan, tapi tetap dibatasi: setiap
  // panggilan menembus ke API Xendit dan menghabiskan kuota di sana.
  PAYMENT_CREATE_IP: { max: 6, windowMs: 5 * MINUTE },
  // Per nomor invoice — satu pesanan tak butuh belasan VA. Menahan skrip yang membuat VA berulang
  // untuk satu pesanan (setiap VA adalah objek baru di dashboard Xendit).
  PAYMENT_CREATE_INVOICE: { max: 5, windowMs: 30 * MINUTE },
} as const satisfies Record<string, RateRule>

// Pesan generik untuk user (JANGAN bocorkan angka limit persis ke klien)
export const RATE_LIMIT_MESSAGE = 'Terlalu banyak percobaan. Silakan coba lagi dalam beberapa menit.'

// === Penyimpanan Counter (in-memory) ===

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Map tidak pernah menyusut sendiri → sapu entri kedaluwarsa berkala agar tidak bocor memori
// pada instance yang berumur panjang (mis. server lokal / VPS).
let writesSinceSweep = 0
const SWEEP_EVERY_WRITES = 500

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}

// === API Limiter ===

// Mengecek & mencatat satu percobaan untuk `key`. Mengembalikan true bila sudah melebihi
// `maxAttempts` dalam jendela waktu `windowMs` berjalan (request ini harus ditolak).
export function isRateLimited(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now()
  if (++writesSinceSweep >= SWEEP_EVERY_WRITES) {
    writesSinceSweep = 0
    sweepExpired(now)
  }

  const entry = buckets.get(key)
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count += 1
  return entry.count > maxAttempts
}

// Mengecek TANPA mencatat percobaan. Dipakai saat pencatatan ditunda sampai hasil diketahui
// (mis. hanya percobaan gagal yang dihitung — lihat PHONE_LOOKUP_IP_PHONE_MISS).
export function isOverLimit(key: string, rule: RateRule): boolean {
  const entry = buckets.get(key)
  if (!entry || entry.resetAt < Date.now()) return false
  return entry.count >= rule.max
}

// Mencatat satu percobaan tanpa mengembalikan keputusan (pasangan `isOverLimit`).
export function recordAttempt(key: string, rule: RateRule): void {
  isRateLimited(key, rule.max, rule.windowMs)
}

// Mengecek + mencatat satu percobaan memakai aturan bernama dari RATE_LIMITS.
// Mengembalikan respons 429 siap-kirim bila limit terlampaui, atau null bila masih boleh lanjut.
export function enforceRateLimit(key: string, rule: RateRule): NextResponse | null {
  if (!isRateLimited(key, rule.max, rule.windowMs)) return null
  return rateLimitResponse(rule, key)
}

// Respons standar saat limit tercapai: 429 + pesan ramah (tanpa detail teknis) + Retry-After.
// `key` hanya untuk log server (masuk Vercel Logs) — sinyal dini brute-force/scraping, menutup
// temuan R3 audit 2026-07-24 (sebelumnya rate-limit terpicu tanpa jejak sama sekali).
export function rateLimitResponse(rule: RateRule, key?: string): NextResponse {
  console.warn(`[rate-limit] terpicu: ${key ?? 'unknown'} (max ${rule.max}/${rule.windowMs}ms)`)
  return NextResponse.json(
    { error: RATE_LIMIT_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(rule.windowMs / 1000)) } },
  )
}

// Ambil IP client dari header proxy. Fallback 'unknown' saat dev lokal/tak ada header.
//
// ── Kenapa TIDAK memakai entri PERTAMA `x-forwarded-for` ──
// `x-forwarded-for` adalah daftar yang TUMBUH dari kiri: entri paling kiri ditulis oleh pihak
// terjauh — dan pihak terjauh itu adalah KLIEN sendiri. Siapa pun bisa mengirim
// `X-Forwarded-For: 1.2.3.4` dan proxy akan menambahkan IP aslinya di KANAN, bukan menimpanya.
// Jadi membaca entri pertama berarti membaca angka yang dipilih penyerang: ia cukup mengubah
// nilainya tiap permintaan untuk mendapat kunci rate-limit baru terus-menerus, dan seluruh
// pembatasan per-IP di aplikasi ini menjadi hiasan belaka.
//
// Urutan di bawah dipilih dari yang paling tepercaya:
//   1. `x-vercel-forwarded-for` — ditulis Vercel Edge dan header `x-vercel-*` dari klien DIBUANG
//      di perbatasan, jadi nilainya tak bisa dipalsukan dari luar.
//   2. `x-real-ip` — ditulis proxy terdekat (Vercel ikut menyetelnya).
//   3. entri TERAKHIR `x-forwarded-for` — yang ditambahkan proxy terdekat, satu-satunya bagian
//      daftar itu yang tidak berasal dari klien.
//
// Menutup separuh temuan SEC-010 (audit: "percaya X-Forwarded-For mentah"). Perbaikan di sini
// berlaku untuk SELURUH pemakai rate limit, bukan hanya login OMS.
export function getClientIp(request: Request): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')
  if (vercel) {
    const first = vercel.split(',')[0]?.trim()
    if (first) return first
  }

  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    // Entri terakhir = ditambahkan proxy terdekat. Sisanya bisa saja karangan klien.
    if (hops.length > 0) return hops[hops.length - 1]!
  }

  return 'unknown'
}
