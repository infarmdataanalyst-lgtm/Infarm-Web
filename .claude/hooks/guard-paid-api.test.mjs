// .claude/hooks/guard-paid-api.test.mjs
// Harness uji untuk guard-paid-api.cjs. Jalankan: node .claude/hooks/guard-paid-api.test.mjs
//
// ⚠️ FILE INI TIDAK BOLEH MELAKUKAN PANGGILAN JARINGAN APA PUN.
// URL berbayar di bawah adalah DATA UJI — string yang dikirim ke hook lewat stdin untuk memastikan
// hook memblokirnya. Karena itu path file ini satu-satunya yang dikecualikan dari pembacaan isi
// file oleh hook (lihat SELF_TEST_PATH di guard-paid-api.cjs). Menambahkan fetch/curl sungguhan
// ke sini akan melewati penjagaan — jangan pernah.

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// fileURLToPath, BUKAN url.pathname: pathname menyisakan %20 untuk spasi di path proyek
// ("Infarm Web"), sehingga hook tak ditemukan dan SETIAP kasus uji tampak "tak diblokir" —
// kegagalan yang menyamar sebagai lolos.
const HOOK = fileURLToPath(new URL('./guard-paid-api.cjs', import.meta.url))

// Dua skrip contoh: satu menyembunyikan panggilan berbayar DI DALAM file (jalur yang dulu lolos),
// satu tak berbahaya. Ditulis ke direktori temporer, bukan ke repo.
const dir = mkdtempSync(join(tmpdir(), 'guard-test-'))
const SNEAKY = join(dir, 'sneaky.mjs')
const HARMLESS = join(dir, 'harmless.mjs')
writeFileSync(SNEAKY, "await fetch('https://sandbox.mengantar.com/api/public/API-XXX/order',{method:'POST'})\n")
writeFileSync(HARMLESS, "await fetch('http://localhost:3000/api/products/list')\n")

// [nama, perintah, harus-diblokir]
const CASES = [
  // --- harus DIBLOKIR: panggilan berbayar ---
  ['curl POST /order', 'curl -X POST "https://sandbox.mengantar.com/api/public/API-XXX/order" -d "{}"', true],
  ['curl POST /time', 'curl -X POST "https://app.mengantar.com/api/public/API-XXX/time" -d "{}"', true],
  ['panggilan tersembunyi di file', `node ${SNEAKY}`, true],
  ['xendit invoice', 'curl -X POST https://api.xendit.co/v2/invoices -u key:', true],
  ['simulate-payment', 'curl -X POST "http://localhost:3000/api/dev/simulate-payment" -d "{}"', true],
  ['grep LALU curl', 'grep -rn x src/ && curl -X POST https://api.xendit.co/v2/invoices', true],
  ['curl DILANJUT grep', 'curl -s https://api.xendit.co/v2/invoices | grep id', true],
  ['bash -c menyamar', 'bash -c "curl -X POST https://api.xendit.co/v2/invoices"', true],

  // --- harus LOLOS: gratis / tanpa efek samping ---
  ['cek ongkir (GET)', 'curl -s "https://sandbox.mengantar.com/api/order/allEstimatePublic?origin_id=a&weight=1"', false],
  ['search alamat (GET)', 'curl -s "https://app.mengantar.com/api/public/test/address/search?keyword=kemayoran"', false],
  ['curl dgn %{time_total}', 'curl -s -w "%{time_total}" "https://app.mengantar.com/api/order/allEstimatePublic?weight=1"', false],
  ['proxy lokal kita (POST)', 'curl -X POST "http://localhost:3000/api/mengantar/shipping/options" -d "{}"', false],
  ['skrip biasa', `node ${HARMLESS}`, false],
  ['perintah tak berkaitan', 'npx tsc --noEmit', false],

  // --- harus LOLOS: alat baca-saja (false positive yang pernah terjadi) ---
  ['grep nama host xendit', 'grep -rn "api.xendit.co" src/', false],
  ['grep + echo + find', 'echo "=== cek ===" && grep -rn "api.xendit.co" src/ && find src -iname "*xendit*"', false],
  ['grep simulate-payment', 'grep -rn "simulate-payment" src/', false],
  ['grep endpoint privat', 'grep -rn "mengantar.com/api/public" src/', false],
  ['cat file webhook', 'cat src/app/api/webhooks/xendit/route.ts', false],
  ['sed -n baca berkas', 'sed -n "1,40p" src/lib/xendit/webhook.ts', false],

  // --- false positive kedua: `cd` di depan rantai perintah baca-saja ---
  ['cd + sed baca route simulasi', 'cd /repo && sed -n "1,40p" src/app/api/dev/simulate-payment/route.ts', false],
  ['cd + grep', 'cd /repo && grep -rn "api.xendit.co" src/', false],
  ['ls folder simulate-payment', 'ls src/app/api/dev/simulate-payment/', false],
  ['cd LALU curl (tetap blok)', 'cd /repo && curl -X POST http://localhost:3000/api/dev/simulate-payment', true],
]

let failed = 0
for (const [name, command, expectBlock] of CASES) {
  let blocked = false
  try {
    execFileSync('node', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    blocked = e.status === 2
  }
  const ok = blocked === expectBlock
  if (!ok) failed += 1
  console.log(
    `${ok ? 'OK   ' : 'GAGAL'} ${name.padEnd(30)} diblokir=${String(blocked).padEnd(5)} (harusnya ${expectBlock})`,
  )
}

console.log(failed === 0 ? `\n${CASES.length}/${CASES.length} lolos` : `\n${failed} kasus GAGAL`)
process.exitCode = failed === 0 ? 0 : 1
