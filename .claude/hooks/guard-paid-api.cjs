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

// Alat BACA-SAJA: tak satu pun bisa mengirim request jaringan, jadi kemunculan nama host di
// perintahnya pasti sekadar pola pencarian atau teks yang dibaca — bukan panggilan.
//
// KENAPA DAFTAR INI ADA: tanpanya, `grep -rn "api.xendit.co" src/` ikut terblokir. Itu false
// positive yang berbahaya bagi penjagaan itu sendiri — penjaga yang menghalangi pekerjaan wajar
// akan berakhir dimatikan orang, dan hilang justru saat benar-benar dibutuhkan. Terjadi nyata pada
// pemakaian pertama: pencarian audit codebase diblokir.
//
// Sengaja TIDAK memuat `bash`, `sh`, `node`, `npx`, `python`, `powershell` — semuanya bisa
// menjalankan apa pun, jadi perintahnya tetap harus diperiksa.
const READ_ONLY_TOOLS = new Set([
  'grep', 'rg', 'egrep', 'fgrep', 'findstr', 'ack',
  'cat', 'head', 'tail', 'less', 'more', 'nl', 'wc',
  'find', 'ls', 'dir', 'tree', 'stat', 'file', 'du',
  'echo', 'printf', 'sort', 'uniq', 'cut', 'tr', 'diff', 'basename', 'dirname',
  // cd/pwd tak punya kemampuan jaringan. Wajib ada di daftar: hampir SETIAP perintah dimulai
  // dengan `cd <proyek> && …`, jadi tanpa ini seluruh rantai perintah selalu diperiksa dan
  // pembacaan berkas biasa ikut terblokir. `cd x && curl y` tetap diperiksa — segmen keduanya curl.
  'cd', 'pwd', 'true', 'false',
  'sed', 'awk', // hanya membaca/menulis teks; tak punya kemampuan jaringan
  'Get-ChildItem', 'Get-Content', 'Select-String', 'Test-Path', 'Measure-Object',
])

// Pemisah antar-perintah di shell. Perintah dipecah agar `grep x && curl y` tetap diperiksa
// (segmen keduanya bukan alat baca-saja).
const COMMAND_SEPARATORS = /\|\||&&|[|;\n]/

// true bila SELURUH segmen perintah adalah alat baca-saja.
// Satu segmen saja yang bukan → seluruh perintah diperiksa. Menolak-dengan-aman: lebih baik
// memeriksa perintah yang sebenarnya jinak daripada melewatkan satu panggilan berbayar.
function isReadOnlyCommand(command) {
  const segments = command.split(COMMAND_SEPARATORS).map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return false
  return segments.every((segment) => {
    // Buang prefix env var (`FOO=bar cmd`) lalu ambil nama programnya
    const tokens = segment.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
    const program = (tokens[0] ?? '').replace(/^.*[/\\]/, '').replace(/\.exe$/i, '')
    return READ_ONLY_TOOLS.has(program)
  })
}

// Pola file skrip yang isinya perlu diperiksa
const SCRIPT_TOKEN = /[\w./\\:-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|ps1)/gi

// SATU-SATUNYA file yang isinya dikecualikan dari pemeriksaan: harness uji hook ini sendiri.
//
// KENAPA PERLU: harness memuat contoh URL berbayar sebagai DATA UJI — string yang dikirim ke hook
// lewat stdin untuk memastikan hook memblokirnya. Tanpa pengecualian ini, hook memblokir
// pengujian dirinya sendiri, dan penjagaan yang tak bisa diuji adalah penjagaan yang tak bisa
// dipercaya.
//
// SYARAT ISI FILE ITU: hanya boleh MENJALANKAN hook ini sebagai subprocess. Tidak boleh ada
// fetch/curl sungguhan, tidak boleh ada kredensial. Pengecualian ini satu path tetap dan pendek
// supaya bisa ditinjau manusia sekali lihat — jangan pernah dilebarkan jadi pola direktori.
// Pemisah di depan `.claude` dibuat opsional supaya path relatif
// (`.claude/hooks/guard-paid-api.test.mjs`) ikut cocok, bukan hanya path absolut.
const SELF_TEST_PATH = /(?:^|[/\\])\.claude[/\\]hooks[/\\]guard-paid-api\.test\.mjs$/i

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
    // Nama endpoint ini juga merupakan NAMA FOLDER di repo
    // (src/app/api/dev/simulate-payment/route.ts), jadi kemunculannya belum tentu panggilan.
    // Yang diblokir hanya yang benar-benar terlihat seperti memanggilnya: ada skema URL, atau ada
    // penanda method POST / klien HTTP di perintah yang sama. Membaca berkasnya tetap boleh.
    name: 'Endpoint simulasi pembayaran',
    test: (s) =>
      /https?:\/\/[^\s'"]*simulate-payment/i.test(s) ||
      (/simulate-payment/i.test(s) &&
        /-X\s*POST|method:\s*['"]POST|Invoke-RestMethod|Invoke-WebRequest/i.test(s)),
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
    if (SELF_TEST_PATH.test(match)) continue
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

// Perintah baca-saja (grep/find/cat/…) tak bisa memanggil apa pun → lewati pemeriksaan.
if (isReadOnlyCommand(command)) process.exit(0)

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
