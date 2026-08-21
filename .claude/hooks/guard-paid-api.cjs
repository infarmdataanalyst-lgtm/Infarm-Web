#!/usr/bin/env node
// .claude/hooks/guard-paid-api.cjs
// PreToolUse hook: MEMBLOKIR perintah shell yang memanggil API pihak ketiga yang MENGHABISKAN UANG
// atau menerbitkan resi nyata.
//
// ── Kenapa hook, bukan cukup deny rule di settings.json ──
// Deny rule hanya melihat STRING PERINTAHNYA. Panggilan berbayar bisa bersembunyi di dalam file
// skrip (`node cek.mjs`), dan isi file itu tak terlihat oleh pencocokan pola perintah. Hook ini
// IKUT MEMBACA file skrip yang disebut di perintah, jadi jalur itu tertutup juga.
//
// ── Apa yang diblokir ──
//   1. Endpoint privat Mengantar  {host}/api/public/{API_KEY}/{order|time}
//      → POST /order memotong saldo & menerbitkan resi; POST /time membuat slot penjemputan.
//   2. API Xendit (api.xendit.co) → pembuatan invoice/charge.
//   3. Endpoint simulasi bayar milik kita (/api/dev/simulate-payment) → memicu booking kurir.
//
// ── Apa yang TIDAK diblokir (sengaja) ──
//   - Cek ongkir `allEstimatePublic` dan search alamat `/api/public/test/address/search`:
//     GRATIS, tanpa API key, tanpa efek samping.
//   - Endpoint lokal `/api/mengantar/...` milik app kita sendiri (proxy) — tak menyentuh
//     endpoint privat Mengantar.
//
// Diblokir bukan berarti tak boleh selamanya: mintalah persetujuan pemilik proyek lebih dulu, dan
// biarkan DIA yang menjalankannya. Blokir keras (exit 2) dipilih supaya keputusannya tak bisa
// diambil sendiri oleh agen — itulah seluruh maksud lapisan ini.

const fs = require('node:fs')

// Batas baca file skrip: cukup untuk skrip normal, cukup kecil agar hook tetap cepat.
const MAX_SCRIPT_BYTES = 200_000

// Pola file skrip yang isinya perlu diperiksa
const SCRIPT_TOKEN = /[\w./\\:-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|ps1)/gi

// Aturan blokir. `test(haystack)` → pesan bila cocok.
const RULES = [
  {
    name: 'Mengantar endpoint privat (POST /order atau /time)',
    test: (s) =>
      /mengantar\.com\/api\/public\//i.test(s) &&
      !/\/api\/public\/test\/address\/search/i.test(s),
    why:
      'Endpoint /api/public/{API_KEY}/... adalah endpoint TULIS Mengantar. POST /order memotong ' +
      'saldo dan menerbitkan resi nyata; POST /time membuat slot penjemputan.',
  },
  {
    name: 'API Xendit',
    test: (s) => /api\.xendit\.co/i.test(s),
    why: 'Pembuatan invoice/charge Xendit menyentuh uang sungguhan.',
  },
  {
    name: 'Endpoint simulasi pembayaran',
    test: (s) => /simulate-payment/i.test(s),
    why:
      'Menandai pesanan LUNAS lalu memicu booking kurir — memotong saldo Mengantar, sama seperti ' +
      'pembayaran sungguhan.',
  },
]

// Membaca payload hook dari stdin. Gagal baca → JANGAN blokir (hook rusak tak boleh
// menghentikan pekerjaan biasa).
function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

// Menggabungkan perintah + isi file skrip yang disebutkan di dalamnya menjadi satu teks periksa.
function buildHaystack(command) {
  let text = command
  for (const match of command.match(SCRIPT_TOKEN) ?? []) {
    try {
      const stat = fs.statSync(match)
      if (!stat.isFile() || stat.size > MAX_SCRIPT_BYTES) continue
      text += '\n' + fs.readFileSync(match, 'utf8')
    } catch {
      // Bukan path nyata (mis. potongan teks yang kebetulan berakhiran .js) → lewati
    }
  }
  return text
}

const payload = readPayload()
if (!payload) process.exit(0)

const tool = payload.tool_name ?? ''
if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0)

const command = payload.tool_input?.command
if (typeof command !== 'string' || command.length === 0) process.exit(0)

const haystack = buildHaystack(command)
const hit = RULES.find((rule) => rule.test(haystack))
if (!hit) process.exit(0)

process.stderr.write(
  `DIBLOKIR oleh .claude/hooks/guard-paid-api.cjs — ${hit.name}\n\n` +
    `${hit.why}\n\n` +
    'Panggilan berbayar TIDAK boleh dijalankan tanpa persetujuan eksplisit pemilik proyek. ' +
    'Jelaskan dulu apa yang akan dipanggil beserta biayanya, lalu biarkan DIA yang menjalankannya. ' +
    'Jangan mencari jalan lain untuk melewati blokir ini (mengganti nama file, merangkai perintah, ' +
    'menyembunyikan URL) — itu melanggar maksud aturannya.\n',
)
process.exit(2)
