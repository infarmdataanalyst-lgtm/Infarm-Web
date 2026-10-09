// src/lib/email-domain.ts
// Memeriksa apakah DOMAIN sebuah email bisa menerima surat, lewat DNS (record MX). SERVER ONLY.
//
// ── Kenapa perlu ──
// lib/email.ts hanya memeriksa BENTUK alamat. `budi@glaim.com` atau `budi@tidakada.xyz` lolos,
// pesanannya terbuat, stok terpotong — tapi tagihan Xendit terkirim ke kotak surat yang tak ada,
// dan pembelinya tak pernah bisa menemukan pesanannya lagi di /track-order, /cancel-order, /review
// (ketiganya mencari berdasarkan email). Pemeriksaan ini menolak domain yang PASTI tak bisa
// menerima email. Ia tidak membuktikan kotak suratnya ada — itu hanya bisa lewat email verifikasi.
//
// ── Prinsip: ragu = loloskan ──
// Hanya dua jawaban DNS yang dianggap pasti "tak bisa menerima email":
//   1. Domain tidak ada sama sekali (NXDOMAIN → ENOTFOUND).
//   2. Domain ada tapi tak punya MX DAN tak punya A/AAAA (tanpa MX, server pengirim jatuh ke
//      alamat A domain itu — RFC 5321 §5.1), atau MX-nya "null MX" yang menyatakan tak menerima
//      email (RFC 7505).
// Semua kondisi lain — DNS lambat, timeout, SERVFAIL, resolver menolak — dianggap 'unknown' dan
// pemanggil WAJIB meloloskannya. Satu email salah yang lolos jauh lebih murah daripada pembeli
// asli yang tak bisa checkout karena DNS sedang tersendat.
//
// ── Beban ──
// Satu pertanyaan DNS kecil (umumnya 10–100 ms), dibatasi CHECK_TIMEOUT_MS, dan hasilnya disimpan
// di memori instance. Domain populer dijawab dari daftar tanpa DNS sama sekali.

import 'server-only'

import { Resolver } from 'node:dns/promises'

export type EmailDomainStatus = 'ok' | 'no-mail' | 'unknown'

// Batas waktu total satu pemeriksaan. Lewat dari ini = 'unknown' (diloloskan).
export const CHECK_TIMEOUT_MS = 1500

// Domain penyedia email besar yang PASTI menerima email — dijawab tanpa DNS. Sekaligus jalur
// tercepat untuk mayoritas pembeli.
const KNOWN_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.id',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'outlook.co.id',
  'live.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
])

// Kebutuhan minimal dari resolver DNS — dipisah supaya unit test bisa memasok resolver palsu.
export type MxResolver = {
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

// Kode galat DNS yang berarti "jawabannya pasti", bukan "gagal bertanya".
const NOT_FOUND = 'ENOTFOUND' // domain tidak ada
const NO_DATA = 'ENODATA' // domain ada, record jenis ini tidak ada

function errorCode(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
}

// Ada alamat A/AAAA? true / false / null (gagal bertanya → tak bisa disimpulkan).
async function hasAddressRecord(domain: string, resolver: MxResolver): Promise<boolean | null> {
  const results = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)])
  let answered = false
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.length > 0) return true
      answered = true
    } else {
      const code = errorCode(r.reason)
      if (code === NO_DATA || code === NOT_FOUND) answered = true
    }
  }
  return answered ? false : null
}

// Inti pemeriksaan, MURNI terhadap resolver yang diberikan (tanpa cache, tanpa timeout).
export async function classifyEmailDomain(domain: string, resolver: MxResolver): Promise<EmailDomainStatus> {
  const d = domain.trim().toLowerCase()
  if (!d) return 'unknown'
  if (KNOWN_MAIL_DOMAINS.has(d)) return 'ok'

  try {
    const records = await resolver.resolveMx(d)
    const usable = records.filter((r) => r.exchange !== '' && r.exchange !== '.')
    if (usable.length > 0) return 'ok'
    // Ada record MX tapi semuanya "null MX" → domain menyatakan tidak menerima email.
    if (records.length > 0) return 'no-mail'
    // Daftar kosong tanpa galat: perlakukan seperti ENODATA.
  } catch (e) {
    const code = errorCode(e)
    if (code === NOT_FOUND) return 'no-mail'
    if (code !== NO_DATA) return 'unknown'
  }

  // Domain ada tapi tanpa MX → server pengirim akan mencoba alamat A/AAAA-nya.
  const hasAddress = await hasAddressRecord(d, resolver)
  if (hasAddress === true) return 'ok'
  if (hasAddress === false) return 'no-mail'
  return 'unknown'
}

// === Cache per instance ===
// Jawaban pasti saja yang disimpan. 'unknown' tidak — percobaan berikutnya layak bertanya lagi.
const OK_TTL_MS = 6 * 60 * 60 * 1000
const NO_MAIL_TTL_MS = 30 * 60 * 1000 // lebih pendek: domain baru bisa saja segera dipasangi MX
const CACHE_MAX_ENTRIES = 1000
const cache = new Map<string, { status: EmailDomainStatus; expiresAt: number }>()

// Hanya untuk unit test.
export function __resetEmailDomainCache(): void {
  cache.clear()
}

let defaultResolver: MxResolver | null = null
function getDefaultResolver(): MxResolver {
  // timeout per percobaan + 1 percobaan ulang; batas totalnya tetap CHECK_TIMEOUT_MS di bawah.
  defaultResolver ??= new Resolver({ timeout: 700, tries: 2 })
  return defaultResolver
}

// Memeriksa domain dari sebuah ALAMAT email. Tidak pernah melempar.
export async function checkEmailDomain(
  email: string,
  opts: { resolver?: MxResolver; timeoutMs?: number; now?: () => number } = {},
): Promise<EmailDomainStatus> {
  const at = email.lastIndexOf('@')
  const domain = at >= 0 ? email.slice(at + 1).trim().toLowerCase() : ''
  if (!domain) return 'unknown'

  const now = opts.now ?? Date.now
  const hit = cache.get(domain)
  if (hit && hit.expiresAt > now()) return hit.status

  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<EmailDomainStatus>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), timeoutMs)
  })

  let status: EmailDomainStatus
  try {
    status = await Promise.race([classifyEmailDomain(domain, opts.resolver ?? getDefaultResolver()), timeout])
  } catch {
    status = 'unknown'
  } finally {
    clearTimeout(timer)
  }

  if (status !== 'unknown') {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear()
    cache.set(domain, { status, expiresAt: now() + (status === 'ok' ? OK_TTL_MS : NO_MAIL_TTL_MS) })
  }
  return status
}
