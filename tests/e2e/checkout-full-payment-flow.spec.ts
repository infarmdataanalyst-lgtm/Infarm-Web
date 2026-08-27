// tests/e2e/checkout-full-payment-flow.spec.ts
// E2E: alur checkout PENUH — beranda → keranjang → alamat → kurir → Xendit → simulasi bayar →
// halaman sukses.
//
// ============================================================================
// ⛔ UJI INI MENGHABISKAN UANG DAN MENERBITKAN DOKUMEN NYATA. BACA DULU.
// ============================================================================
// Berbeda dari seluruh spec lain di folder ini (yang murni MEMBACA), uji ini menembus batas
// pembayaran. Sekali jalan ia menimbulkan efek yang TIDAK bisa dibatalkan dari sisi kita:
//
//   1. `POST /api/orders/create` → baris nyata di tabel `orders` + `order_items`,
//      dan STOK PRODUK BERKURANG lewat RPC atomik `create_order_with_items`.
//   2. `POST /api/payments/invoice` → panggilan ke api.xendit.co, menerbitkan invoice.
//      Dengan kunci test (`xnd_development_…`) tak ada uang sungguhan yang berpindah.
//      Dengan kunci LIVE, ini uang nyata — dan `xenditCredentials()` memang menolak kunci live
//      di luar deployment produksi, tapi jangan bergantung pada penjaga itu sebagai izin.
//   3. Simulasi bayar di halaman Xendit → callback `POST /api/webhooks/xendit` → status Lunas →
//      `bookShipmentForPaidOrder()` → **`POST {host}/api/public/{KEY}/order` ke Mengantar**.
//      Itu memotong saldo Mengantar dan MENERBITKAN RESI NYATA. Tak bisa dibatalkan.
//
// CLAUDE.md → "Panggilan API Berbayar — WAJIB Konfirmasi Pemilik Proyek" melarang menjalankan ini
// tanpa persetujuan eksplisit pemilik proyek. Karena itu uji ini TIDAK IKUT berjalan pada
// `npx playwright test` biasa; ia dilewati kecuali dinyalakan sengaja:
//
//     E2E_ALLOW_PAID=1 npx playwright test checkout-full-payment-flow --headed
//
// Sakelar itu bukan formalitas — ia satu-satunya hal yang memisahkan "menjalankan seluruh uji"
// dari "menerbitkan resi tanpa sadar".
//
// ============================================================================
// ⚠️ DI LOCALHOST, LANGKAH 12 TAK AKAN TERBUKTI
// ============================================================================
// Xendit mengirim callback pembayaran dari servernya ke URL webhook kita. Server Xendit TIDAK BISA
// menjangkau `http://localhost:3000`. Jadi saat dijalankan terhadap dev server lokal:
//
//   - Redirect balik ke halaman sukses TETAP terjadi (itu redirect BROWSER, bukan callback).
//   - Tapi `status_pembayaran` tetap `Menunggu`, `order_status` tetap `Menunggu Pembayaran`,
//     dan `no_tracking` tetap KOSONG — karena webhook-nya tak pernah tiba.
//
// Artinya: booking kurir juga tak terpicu di localhost (satu-satunya sisi baiknya — efek termahal
// dari daftar di atas TIDAK terjadi saat menguji lokal).
//
// Untuk benar-benar memverifikasi `order_status` + `no_tracking` seperti yang kamu maksud, webhook
// harus bisa dijangkau. Dua cara:
//   (a) Tunnel ke mesin lokal (mis. `ngrok http 3000`), daftarkan URL-nya di Xendit Dashboard →
//       Settings → Webhooks, lalu jalankan dengan
//       `PLAYWRIGHT_BASE_URL=https://xxx.ngrok.app E2E_ALLOW_PAID=1 npx playwright test …`
//       ⛔ CATATAN: begitu webhook tiba, BOOKING KURIR MENGANTAR IKUT TERPICU.
//   (b) Jalankan terhadap deployment preview/produksi yang webhook-nya sudah terdaftar.
//
// Karena itu assertion status pembayaran di langkah 12 SENGAJA tidak dipaksakan; yang dicetak
// adalah keadaan apa adanya + nomor invoice, supaya kamu bisa memeriksanya sendiri di Supabase.
//
// ============================================================================
// ⚠️ SELEKTOR HALAMAN XENDIT = TEBAKAN TERDIDIK, BUKAN HASIL PENGAMATAN
// ============================================================================
// Kamu minta agar selektor halaman Xendit dicek dulu, bukan ditebak. Itu tak bisa dilakukan tanpa
// menerbitkan invoice sungguhan lebih dulu — dan menerbitkannya butuh persetujuanmu (lihat blok
// pertama). Jadi bagian Xendit di bawah ditulis dengan pola:
//
//   - screenshot + dump teks tombol/heading SEBELUM mencoba mengklik apa pun,
//   - daftar kandidat label (bukan satu selektor kaku),
//   - kegagalan yang menyebut persis apa yang ADA di halaman.
//
// Jalankan sekali, lihat `tests/e2e/screenshots/xendit-*.png` dan keluaran konsolnya, lalu
// kunci selektornya di konstanta di bawah. Jangan biarkan tebakan ini mengendap jadi permanen.
//
// ── Batas yang tetap dijaga ──
// Satu pesanan per eksekusi, kuantitas 1, produk termurah yang berstok. Serial, tak pernah paralel.

import { test, expect, type Page } from '@playwright/test'

// === Sakelar izin ===
// Tanpa ini uji dilewati. Lihat blok peringatan di atas.
const ALLOW_PAID = process.env.E2E_ALLOW_PAID === '1'

// === Data pembeli uji ===
// Nama diberi penanda jelas supaya barisnya mudah dikenali (dan dibersihkan) di tabel `orders`.
// Nomor telepon: 08xx, 10–12 digit (src/lib/phone.ts). 12 digit dipakai = batas atas yang sah.
//
// ⚠️ Nomor ini dikirim ke Xendit sebagai tujuan notifikasi WhatsApp/SMS. Ganti dengan nomormu
// sendiri bila ingin memverifikasi notifikasi; jangan pakai nomor orang lain.
const BUYER = {
  name: 'E2E Playwright Test',
  phone: '081234567890', // 12 digit
  street: 'Jl. Uji Otomatis No. 1, Blok E2E',

  // ⚠️ WAJIB tujuan DKI JAKARTA. Sandbox Mengantar yang dipakai sekarang hanya melayani rute
  // gudang Jakarta → tujuan Jakarta; tujuan luar Jakarta mengembalikan daftar kurir KOSONG, dan
  // ujinya gagal di langkah kurir karena data pihak ketiga, bukan karena kode kita.
  //
  // Gudang asal = CENGKARENG BARAT, Jakarta Barat (MENGANTAR_PICKUP_ORIGIN_ID di .env.local).
  addressKeyword: 'jakarta pusat',
}

// Provinsi yang wajib muncul setelah alamat dipilih. Penjaga terhadap keyword yang tanpa sengaja
// diganti ke luar Jakarta di kemudian hari — lebih baik gagal di sini, dengan sebab yang jelas,
// daripada gagal di langkah kurir dengan gejala "tak ada opsi kurir".
const PROVINSI_WAJIB = /jakarta/i

// === Halaman Xendit (diamati langsung, bukan tebakan) ===
//
// Struktur di bawah berasal dari halaman sungguhan pada 2026-08-27, locale id-ID:
//
//   [banner merah]  "Anda berada dalam Mode Uji Coba, setiap transaksi … simulasi dan tidak nyata."
//   METODE PEMBAYARAN
//     ▸ Transfer Bank            ← section yang bisa dilipat, SUDAH TERBUKA saat halaman dibuka
//         Bank Sampoerna · Bank Muamalat · CIMB NIAGA · BNI · Permata Bank · BCA
//         mandiri · neobank · BANK BRI · BSI · bank bjb · Other Banks
//
// Setelah bank dipilih:
//   [banner merah]  "Klik disini untuk simulasi pembayaran dengan BCA"   ← tautan
//   Virtual Account Number        3816596235462
//   Nama Virtual Account          Infarm
//   Nominal yang akan dibayarkan  IDR 79.080
//   Transaksi #: INV-2026…

// Judul section metode pembayaran. ⚠️ Section ini SUDAH TERBUKA — mengkliknya justru MELIPATNYA
// dan bank-banknya hilang. Karena itu ia hanya diklik bila banknya belum terlihat (lihat langkah 8).
const BANK_TRANSFER_LABELS = ['Transfer Bank', 'Bank Transfer', 'Virtual Account']

// Bank yang dipakai. BCA, bukan BRI: itu yang tersedia & dipilih saat alur ini ditelusuri manual.
// Tautan simulasi di banner merah menyesuaikan diri dengan bank yang dipilih.
const BANK = 'BCA'

// Tautan simulasi pembayaran di banner merah. HANYA ada di Mode Uji Coba Xendit.
// Teks aslinya "Klik disini untuk simulasi pembayaran dengan BCA" — dicocokkan longgar supaya
// tetap kena bila nama banknya diganti atau kalimatnya sedikit berubah.
const SIMULATE_LINK_PATTERN = /simulasi pembayaran|simulate payment/i

// ⚠️ Xendit menulis nominal sebagai "IDR 79.080", BUKAN "Rp79.080".
// Mencari "Rp" di halaman ini menghasilkan NOL kecocokan, dan assertion nominal gagal padahal
// angkanya benar. Pola di bawah menerima keduanya.
const NOMINAL_PATTERN = /(?:IDR|Rp)\s?[\d.,]+/g

// Nomor invoice proyek ini: INV-{YYYYMMDD}-{8 karakter acak alfanumerik KAPITAL}.
//
// ⚠️ Bukan 4 digit. Generator di src/lib/mock-db/orders.ts memakai 8 karakter acak sejak
// integrasi Xendit — pola lama `INV-20260820-4876` sudah tak diterbitkan lagi.
const INVOICE_PATTERN = /INV-\d{8}-[A-Z0-9]{8}/

// "Rp123.456" → 123456
function parseRupiah(text: string): number {
  const digits = text.replace(/\D/g, '')
  return digits ? Number(digits) : NaN
}

// Mencetak struktur halaman pihak ketiga ke konsol + menyimpan screenshot.
//
// Ini pengganti "cek dulu selektornya": karena halaman Xendit tak bisa diintip tanpa menerbitkan
// invoice, uji ini yang melaporkannya balik saat pertama kali dijalankan.
async function dumpPageStructure(page: Page, label: string, screenshotPath: string): Promise<void> {
  await page.screenshot({ path: screenshotPath, fullPage: true })

  const headings = await page.getByRole('heading').allTextContents()
  const buttons = await page.getByRole('button').allTextContents()
  const links = await page.getByRole('link').allTextContents()

  // Alt gambar ikut dicetak. Tanpanya dump ini berbohong: tombol bank di Xendit TIDAK punya teks
  // sama sekali (hanya `<img alt="BCA">`), jadi daftar tombol tampil sebagai deretan string kosong
  // dan terbaca seperti "tak ada tombol apa pun" — persis salah baca yang pernah terjadi.
  const images = await page.getByRole('img').evaluateAll((els) =>
    els.map((el) => el.getAttribute('alt') ?? '').filter(Boolean),
  )

  const bersih = (arr: string[]) =>
    arr.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25)

  console.log(`\n  ── struktur halaman: ${label} ──`)
  console.log(`  url      : ${page.url()}`)
  console.log(`  heading  : ${JSON.stringify(bersih(headings))}`)
  console.log(`  tombol   : ${JSON.stringify(bersih(buttons))}`)
  console.log(`  tautan   : ${JSON.stringify(bersih(links))}`)
  console.log(`  alt img  : ${JSON.stringify(bersih(images))}`)
  console.log(`  gambar   : ${screenshotPath}\n`)
}

// === Kecepatan & rekaman ===
//
// slowMo MATI secara default — uji berjalan penuh kecepatan.
//
// Sempat 200ms lalu 600ms, keduanya dibuang: slowMo hanya memperlambat AKSI Playwright (klik,
// ketik, pilih), bukan navigasi, permintaan jaringan, atau `waitFor*`. Jadi ia tak pernah benar-
// benar membuat alurnya bisa diikuti mata — hanya memperpanjang durasi uji berbayar ini tanpa
// imbalan. Yang menggantikannya: jejak & video di bawah, yang bisa diputar ulang sepuasnya.
//
// Masih bisa dinyalakan bila memang perlu: E2E_SLOWMO=1000 npx playwright test …
const SLOWMO = Number(process.env.E2E_SLOWMO ?? 0)

// WAJIB di tingkat berkas, bukan di dalam describe: mengubah launchOptions memaksa worker baru,
// dan Playwright menolaknya bila dideklarasikan di dalam grup.
test.use({
  launchOptions: { slowMo: Number.isFinite(SLOWMO) ? SLOWMO : 0 },

  // Jejak SELALU direkam untuk uji ini, bukan hanya saat gagal.
  //
  // Alasannya: uji ini tak bisa diulang dengan bebas — sekali jalan ia membuat pesanan nyata dan
  // memotong stok. Jadi satu-satunya kesempatan memeriksa "apa yang sebenarnya terjadi" adalah
  // rekaman dari jalan yang ITU. Menunggu sampai gagal lalu mengulang bukan pilihan yang murah
  // di sini, beda dari spec lain di folder ini yang murni membaca.
  //
  // Dibuka dengan `npx playwright show-report` → klik ujinya → tab Trace: ada timeline, snapshot
  // DOM sebelum/sesudah tiap aksi, dan log jaringan.
  //
  // Video sengaja TIDAK dinyalakan: jejak sudah memuat snapshot DOM tiap langkah — bisa ditelusuri
  // dan elemennya diperiksa, sesuatu yang tak bisa dilakukan pada rekaman video.
  trace: 'on',
})

// Serial + timeout panjang: alur lintas-domain dengan dua kali redirect eksternal. Timeout diatur
// lewat describe.configure — `test.setTimeout()` hanya sah di dalam badan uji, bukan di badan grup.
test.describe.configure({ mode: 'serial', timeout: 300_000 })

test.describe('Checkout — alur penuh sampai pembayaran selesai', () => {
  // Dilewati kecuali sakelar izin dinyalakan. Alasannya ikut tercetak di laporan supaya tak
  // terlihat seperti uji yang "hilang".
  test.skip(
    !ALLOW_PAID,
    'Uji berbayar: membuat pesanan nyata, invoice Xendit, dan (bila webhook terjangkau) resi ' +
      'Mengantar. Butuh persetujuan pemilik proyek — jalankan dengan E2E_ALLOW_PAID=1.',
  )

  test('pesanan dibuat, dibayar di Xendit, dan halaman sukses menampilkan invoice yang benar', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()

    const isLocalhost = /localhost|127\.0\.0\.1/.test(baseURL!)
    if (isLocalhost) {
      console.log(
        '\n  ⚠ Menjalankan terhadap localhost — server Xendit tak bisa mengirim callback ke sini.\n' +
          '    Status pembayaran & no_tracking TIDAK akan ter-update. Lihat catatan di kepala berkas.\n',
      )
    }

    // Exception JS tak tertangkap dikumpulkan sepanjang alur (hanya untuk halaman kita sendiri —
    // error dari domain Xendit di luar kendali kita, jadi dicatat tapi tak membuat uji gagal).
    const ourPageErrors: string[] = []
    page.on('pageerror', (err) => {
      if (page.url().startsWith(baseURL!)) ourPageErrors.push(err.message)
    })

    // ================================================================
    // Langkah 1 — beranda → produk → keranjang → checkout
    // ================================================================
    await page.goto('/')

    const kartuProduk = page.locator('a[href^="/produk/"]').first()
    await expect(kartuProduk, 'tak ada kartu produk di beranda').toBeVisible({ timeout: 30_000 })

    // Tujuan dicatat lebih dulu — dipakai sebagai jaring pengaman di bawah, dan berguna di log.
    const hrefProduk = (await kartuProduk.getAttribute('href')) ?? ''

    // ⚠️ Klik diulang sampai URL benar-benar berpindah, bukan diklik sekali lalu diharapkan.
    //
    // Sekali klik TIDAK cukup dan terbukti gagal di deployment Vercel: `toBeVisible()` lolos
    // segera setelah kartu dirender, tapi gambar produk & hero masih dalam perjalanan. Begitu
    // gambar mendarat, tata letak bergeser ke bawah dan klik yang sudah terkirim jatuh ke ruang
    // kosong — tak ada error, tak ada navigasi. Di localhost gejalanya tak pernah muncul karena
    // gambarnya dilayani dari disk dan pergeserannya selesai sebelum uji sempat mengklik.
    //
    // `load` ditunggu dulu supaya percobaan pertama biasanya sudah cukup; retry hanya jaring.
    await page.waitForLoadState('load').catch(() => {})

    await expect(async () => {
      await kartuProduk.click()
      await expect(page).toHaveURL(/\/produk\//, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })

    // Nama & harga produk dicatat untuk dicocokkan lagi di ringkasan halaman sukses (langkah 12).
    const namaProduk = (await page.getByRole('heading').first().textContent())?.trim() ?? ''

    const beliLangsung = page.getByRole('button', { name: 'Beli Langsung' }).first()
    await expect(beliLangsung).toBeVisible({ timeout: 30_000 })

    // Diulang dengan alasan yang sama seperti kartu produk di atas: halaman detail memuat slider
    // gambar, dan tombolnya bergeser saat gambar mendarat.
    //
    // Satu percabangan penting di dalam loop: produk BERVARIAN membuka bottom-sheet "Pilih Varian"
    // lebih dulu, produk biasa langsung meluncur ke checkout. Kalau sheet-nya sudah terbuka, yang
    // diklik adalah tombol konfirmasinya — bukan "Beli Langsung" lagi, yang kini tertutup sheet.
    const konfirmasiVarian = page.getByRole('button', { name: 'Beli Sekarang' })

    await expect(async () => {
      if (!/\/checkout$/.test(page.url())) {
        if (await konfirmasiVarian.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await konfirmasiVarian.click()
        } else {
          await beliLangsung.click()
        }
      }
      await expect(page).toHaveURL(/\/checkout$/, { timeout: 5_000 })
    }).toPass({ timeout: 60_000 })
    await expect(page.getByRole('heading', { name: 'Alamat Pengiriman' })).toBeVisible()
    console.log(`  produk: ${namaProduk}  (${hrefProduk})`)

    // ================================================================
    // Langkah 2 — isi form alamat
    // ================================================================
    // ⚠️ TIDAK ADA FIELD EMAIL di form ini. Field itu sudah dihapus dari checkout (CLAUDE.md →
    // "Sistem Belanja: Guest Checkout"): identitas guest sekarang murni nomor telepon, selaras
    // dengan lacak/batalkan/review by phone. Order baru selalu mengirim `customerEmail: undefined`.
    //
    // Pengisian diulang sampai menempel: `fill` yang mendarat sebelum hidrasi React selesai akan
    // ditimpa state awal yang kosong.
    async function isiTeguh(label: string, value: string) {
      const field = page.getByLabel(label)
      await expect(field, `field "${label}" tak ditemukan`).toBeVisible()
      await expect(async () => {
        await field.fill(value)
        await expect(field).toHaveValue(value, { timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
    }

    await isiTeguh('Nama Lengkap Penerima', BUYER.name)
    await isiTeguh('Nomor Telepon Aktif', BUYER.phone)

    // Pencarian alamat sungguhan ke API Mengantar (BACA, gratis).
    await isiTeguh('Cari Alamat (Kelurahan / Kecamatan / Kota)', BUYER.addressKeyword)

    // Ditunggu OPSI pertama, bukan kotak listbox — panel sempat merender listbox kosong.
    const opsiAlamat = page.getByRole('listbox').getByRole('option').first()
    await expect(
      opsiAlamat,
      `tak ada hasil alamat untuk "${BUYER.addressKeyword}"`,
    ).toBeVisible({ timeout: 30_000 })

    const alamatTerpilih = ((await opsiAlamat.textContent()) ?? '').trim()
    await opsiAlamat.click()

    // Wilayah harus benar-benar terisi sebelum lanjut — kode pos kosong berarti auto-isi gagal
    // separuh, dan ongkir yang dihitung setelahnya tak bisa dipercaya.
    await expect(page.getByLabel('Kode Pos')).toHaveValue(/^\d{5}$/)

    // Tujuan WAJIB DKI Jakarta (lihat catatan di konstanta BUYER). Diperiksa di sini, bukan
    // dibiarkan menjelma jadi "daftar kurir kosong" di langkah berikutnya — gejala yang sama
    // persis dengan bug sungguhan pada perhitungan ongkir, dan karena itu menyesatkan.
    await expect(
      page.getByLabel('Provinsi'),
      `tujuan harus di DKI Jakarta (sandbox Mengantar hanya melayani rute Jakarta→Jakarta), ` +
        `tapi keyword "${BUYER.addressKeyword}" menghasilkan "${alamatTerpilih}"`,
    ).toHaveValue(PROVINSI_WAJIB)

    await isiTeguh('Alamat Lengkap (Nama Jalan & Nomor Rumah)', BUYER.street)
    console.log(`  alamat: ${alamatTerpilih}`)

    // ================================================================
    // Langkah 3 — pilih kurir di bottom sheet
    // ================================================================
    const daftarKurir = page.getByRole('radiogroup', { name: 'Pilihan kurir' })

    // Memilih alamat biasanya membuka sheet-nya sendiri; kalau tidak, dibuka manual.
    if (!(await daftarKurir.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first().click()
    }

    // Pesan kegagalan menyebut bahwa alamatnya SUDAH di Jakarta, supaya penyebabnya tak salah
    // dibaca sebagai "tujuan tak didukung sandbox". Kalau blok ini merah padahal provinsi lolos
    // pemeriksaan di atas, masalahnya di sisi kita: origin gudang, stok, berat, atau daftar putih
    // kurir (`ALLOWED_COURIER_IDS` di src/lib/mengantar-estimate.ts hanya mengizinkan 'JT').
    const konteksGagal =
      `Alamat tujuan sudah di DKI Jakarta ("${alamatTerpilih}") dan gudang asal juga Jakarta, ` +
      `jadi rute ini SEHARUSNYA dilayani sandbox Mengantar. Periksa: stok gudang, ` +
      `berat produk (gram→kg via lib/shipping-weight.ts), origin_id, atau daftar putih kurir 'JT'.`

    // Ongkir dihitung dengan memanggil Mengantar untuk tiap gudang berstok — beri waktu longgar.
    await expect(
      daftarKurir,
      `daftar kurir tak muncul sama sekali. ${konteksGagal}`,
    ).toBeVisible({ timeout: 45_000 })

    const semuaOpsi = daftarKurir.getByRole('radio')
    const opsiKurir = semuaOpsi.first()
    await expect(
      opsiKurir,
      `sheet kurir terbuka tapi KOSONG — tak ada satu pun opsi. ${konteksGagal}`,
    ).toBeVisible({ timeout: 45_000 })

    const jumlahKurir = await semuaOpsi.count()
    expect(jumlahKurir, `minimal 1 opsi kurir wajib ada. ${konteksGagal}`).toBeGreaterThan(0)

    const teksKurir = ((await opsiKurir.textContent()) ?? '').replace(/\s+/g, ' ').trim()
    const ongkirCocok = teksKurir.match(/Rp[\d.]+/)
    expect(ongkirCocok, `harga tak ditemukan pada opsi kurir: "${teksKurir}"`).toBeTruthy()
    const ongkir = parseRupiah(ongkirCocok![0])
    expect(
      ongkir,
      `ongkir harus lebih dari 0, dapat "${ongkirCocok![0]}" — ongkir Rp0 berarti respons ` +
        `Mengantar tak terpetakan dengan benar, dan pembeli akan ditagih kurang.`,
    ).toBeGreaterThan(0)

    await opsiKurir.click()

    // ⚠️ Mengklik opsi kurir BELUM memilih apa pun.
    //
    // `onClick` opsi hanya menyetel `draftId` — state DRAFT di dalam sheet. `onSelect()` yang
    // mengabari halaman checkout baru dipanggil dari `handleConfirm()`, yaitu saat tombol
    // "Konfirmasi" ditekan (lihat src/components/checkout/ShippingOptions.tsx). Tanpa langkah ini
    // `selectedCourier` tetap null, `canPay` tetap false, dan sheet-nya menutupi tombol bayar —
    // ujinya menggantung di layar "Pilih Kurir Pengiriman" tanpa error yang menjelaskan apa pun.
    const tombolKonfirmasi = page.getByRole('button', { name: 'Konfirmasi' })
    await expect(
      tombolKonfirmasi,
      'tombol "Konfirmasi" masih nonaktif — opsi kurir kemungkinan tak benar-benar terpilih',
    ).toBeEnabled({ timeout: 10_000 })
    await tombolKonfirmasi.click()

    // Bukti `onSelect` benar-benar jalan: baris trigger "Metode Pengiriman" berubah dari
    // "Pilih Kurir Pengiriman" menjadi "{nama} — {harga} ({estimasi})".
    //
    // Diperiksa lewat trigger, BUKAN dengan memastikan sheet tersembunyi: BottomSheet tetap
    // ter-mount saat tertutup (digeser lewat transform + pointer-events-none), jadi pemeriksaan
    // "sudah hilang?" bisa lolos padahal tak ada yang terpilih.
    await expect(
      page.getByRole('button').filter({ hasText: 'Metode Pengiriman' }).first(),
      'kurir tak tersimpan setelah Konfirmasi — baris Metode Pengiriman masih kosong',
    ).toContainText(/Rp[\d.]+/, { timeout: 10_000 })

    console.log(`  kurir : ${jumlahKurir} opsi, dipilih "${teksKurir}"`)

    // ================================================================
    // Langkah 4 — total sebelum bayar, lalu klik "Bayar Sekarang"
    // ================================================================
    // Total dibaca dari bilah bayar, BUKAN dihitung sendiri di uji. Menghitung ulang di sini
    // berarti menduplikasi logika promo/diskon aplikasi — dan uji yang menyalin logika yang
    // diujinya akan ikut salah dengan cara yang sama.
    //
    // `.first()` : CheckoutBottomBar dirender dua kali (varian sticky + panel), hanya satu tampak
    // per ukuran layar. Keduanya menampilkan angka yang sama.
    const totalTeks = await page
      .getByText('Total Pembayaran')
      .first()
      .locator('xpath=following-sibling::p[1]')
      .textContent()
    const totalCheckout = parseRupiah(totalTeks ?? '')
    expect(
      Number.isFinite(totalCheckout) && totalCheckout > 0,
      `total pembayaran tak terbaca, dapat "${totalTeks}"`,
    ).toBeTruthy()
    console.log(`  total : Rp${totalCheckout.toLocaleString('id-ID')} (ongkir Rp${ongkir.toLocaleString('id-ID')})`)

    await page.getByRole('button', { name: 'Bayar Sekarang' }).first().click()

    // ================================================================
    // Langkah 5 — popup konfirmasi
    // ================================================================
    // ⚠️ Popup ini (PhoneConfirmModal) HANYA menampilkan NOMOR TELEPON — tidak ada nama maupun
    // alamat di dalamnya. Kamu memintanya diperiksa bertiga; yang bisa diperiksa hanya telepon.
    // Nama & alamat karena itu diperiksa di FORM-nya (masih terlihat di belakang modal), bukan
    // dikarang seolah ada di popup.
    const modal = page.getByRole('dialog')
    await expect(
      modal.getByRole('heading', { name: 'Pastikan data yang Anda masukkan benar' }),
    ).toBeVisible({ timeout: 15_000 })

    await expect(
      modal.getByText(BUYER.phone, { exact: true }),
      `popup menampilkan nomor telepon yang berbeda dari yang diisi (${BUYER.phone})`,
    ).toBeVisible()

    // Nama & alamat — diperiksa dari form, sumber yang benar-benar memuatnya.
    await expect(page.getByLabel('Nama Lengkap Penerima')).toHaveValue(BUYER.name)
    await expect(page.getByLabel('Alamat Lengkap (Nama Jalan & Nomor Rumah)')).toHaveValue(
      BUYER.street,
    )

    // ================================================================
    // Langkah 6 — konfirmasi → pesanan DIBUAT (titik tak bisa kembali)
    // ================================================================
    // Sejak klik ini, satu baris `orders` sudah ada dan stok sudah berkurang. Uji yang gagal
    // setelah titik ini TIDAK membatalkan pesanan itu — bersihkan manual bila perlu.
    console.log('\n  ⛔ menekan "Lanjutkan Checkout" — pesanan nyata dibuat mulai detik ini\n')
    await modal.getByRole('button', { name: 'Lanjutkan Checkout' }).click()

    // ================================================================
    // Langkah 7 — tunggu redirect ke Xendit
    // ================================================================
    // Pola URL dibuat longgar: Xendit memakai `checkout.xendit.co` di produksi dan
    // `checkout-staging.xendit.co` di mode test, dan pernah berpindah subdomain.
    await page.waitForURL(/xendit\.co/, { timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded')
    console.log(`  → Xendit: ${page.url()}`)

    // ================================================================
    // Langkah 8 — pilih metode Transfer Bank
    // ================================================================
    // Struktur halaman dilaporkan DULU, sebelum interaksi apa pun. Kalau langkah ini gagal,
    // keluaran konsol + screenshot inilah yang memberi tahu selektor sebenarnya.
    await dumpPageStructure(page, 'Xendit — pilih metode', 'tests/e2e/screenshots/xendit-1-metode.png')

    // Nomor invoice DICATAT DI SINI, bukan hanya di halaman sukses nanti.
    //
    // Halaman Xendit memuat "Transaksi #: INV-…" di panel Ringkasan Pesanan. Diambil sekarang
    // karena pesanannya SUDAH ADA di database sejak langkah 6 — kalau uji mati di mana pun setelah
    // titik ini, nomor itu tetap tercetak dan kamu masih bisa menelusurinya di Supabase. Tanpa ini,
    // kegagalan di tengah alur meninggalkan pesanan yatim tanpa nomor.
    const isiXendit = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const invoiceDariXendit = isiXendit.match(INVOICE_PATTERN)?.[0] ?? ''
    if (invoiceDariXendit) {
      console.log(`\n  ▸ INVOICE: ${invoiceDariXendit}  (pesanan sudah ada di DB, status Menunggu)\n`)
      test.info().annotations.push({ type: 'invoice', description: invoiceDariXendit })
    }

    // ⚠️ Tombol bank TIDAK PUNYA TEKS. Isinya hanya `<img alt="BCA">`:
    //
    //     region "Transfer Bank"
    //       list > listitem > button > img "BCA"
    //
    // `getByText(/BCA/)` karena itu mustahil menemukannya — nol kecocokan, dan pesan gagalnya
    // menuduh section-nya tertutup padahal terbuka. Yang benar: cari tombol yang MEMUAT gambar
    // ber-alt "BCA".
    //
    // Section "Transfer Bank" sendiri sudah `[expanded]` saat halaman dibuka. Mengkliknya tanpa
    // syarat justru melipatnya, jadi ia hanya diklik bila region-nya memang belum ada.
    const areaBank = page.getByRole('region', { name: 'Transfer Bank' })

    if (!(await areaBank.isVisible({ timeout: 5_000 }).catch(() => false))) {
      let sectionDibuka = ''
      for (const label of BANK_TRANSFER_LABELS) {
        const kandidat = page.getByRole('button', { name: label, exact: false }).first()
        if (await kandidat.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await kandidat.click()
          sectionDibuka = label
          break
        }
      }
      expect(
        sectionDibuka,
        `section metode transfer bank tak terbuka dan tak ada judulnya yang bisa diklik. ` +
          `Dicoba: ${BANK_TRANSFER_LABELS.join(', ')}. ` +
          `Lihat tests/e2e/screenshots/xendit-1-metode.png.`,
      ).toBeTruthy()
      console.log(`  section dibuka: "${sectionDibuka}"`)
    }

    const tombolBank = areaBank
      .getByRole('button')
      .filter({ has: page.getByRole('img', { name: BANK, exact: true }) })
      .first()

    await expect(
      tombolBank,
      `bank "${BANK}" tak ada di daftar metode pembayaran. Daftar bank di halaman ini mengikuti ` +
        `pengaturan Payment Methods di dashboard Xendit — periksa ` +
        `tests/e2e/screenshots/xendit-1-metode.png.`,
    ).toBeVisible({ timeout: 15_000 })

    await tombolBank.click()
    console.log(`  bank dipilih: ${BANK}`)

    // ================================================================
    // Langkah 9 — assert nomor VA + nominal
    // ================================================================
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await dumpPageStructure(page, 'Xendit — halaman VA', 'tests/e2e/screenshots/xendit-2-va.png')

    // Ditunggu labelnya muncul dulu — halaman VA dirender setelah Xendit menerbitkan nomornya,
    // bukan langsung setelah bank diklik.
    await expect(
      page.getByText('Virtual Account Number'),
      'halaman Virtual Account tak terbuka setelah bank dipilih',
    ).toBeVisible({ timeout: 30_000 })

    const isiHalaman = (await page.locator('body').innerText()).replace(/\s+/g, ' ')

    // Ketiga nilai diambil DARI LABELNYA, bukan dengan menyapu seluruh halaman mencari pola.
    //
    // Sempat memakai regex "deretan digit panjang" untuk nomor VA; itu rapuh dua arah — VA BCA
    // hanya 13 digit (di bawah ambang yang diasumsikan), sementara nomor telepon, kode pos, dan
    // timestamp di halaman yang sama juga deretan digit. Label adalah jangkar yang jauh lebih jujur.
    function ambilSetelahLabel(label: string, pola: string): string {
      const cocok = isiHalaman.match(new RegExp(`${label}\\s*(${pola})`, 'i'))
      return cocok ? cocok[1].trim() : ''
    }

    const nomorVA = ambilSetelahLabel('Virtual Account Number', '[\\d\\s]{8,30}').replace(/\s/g, '')
    expect(
      nomorVA,
      'nomor Virtual Account tak terbaca. Lihat tests/e2e/screenshots/xendit-2-va.png.',
    ).toMatch(/^\d{8,20}$/)

    const namaVA = ambilSetelahLabel('Nama Virtual Account', '[^\\n]{1,60}?(?=\\s*Nominal|$)')
    const nominalTeks = ambilSetelahLabel(
      'Nominal yang akan dibayarkan',
      '(?:IDR|Rp)\\s?[\\d.,]+',
    )

    console.log(`  VA    : ${nomorVA}  (${namaVA || '—'})  ${nominalTeks || '—'}`)

    // === Nominal harus SAMA PERSIS dengan total di checkout ===
    //
    // Selisih berarti nominal invoice tak bersumber dari tabel `orders` — celah yang justru dijaga
    // oleh endpoint invoice (client hanya boleh mengirim nomor invoice, bukan nominal).
    //
    // ⚠️ Xendit menulis "IDR 79.080", bukan "Rp79.080". Mencari "Rp" saja di halaman ini
    // menghasilkan nol kecocokan dan assertion ini gagal padahal angkanya benar.
    const nominalDitemukan = Array.from(isiHalaman.matchAll(NOMINAL_PATTERN)).map((m) =>
      parseRupiah(m[0]),
    )
    expect(
      nominalDitemukan,
      `nominal Rp${totalCheckout.toLocaleString('id-ID')} tak ada di halaman Xendit. ` +
        `Yang ditemukan: ${nominalDitemukan.map((n) => `Rp${n.toLocaleString('id-ID')}`).join(', ') || '(tak ada)'}. ` +
        `Selisih nominal = invoice tak bersumber dari tabel orders.`,
    ).toContain(totalCheckout)

    // Nama VA = nama akun tujuan. Xendit menampilkan nama MERCHANT ("Infarm"), bukan nama pembeli
    // — jadi yang diperiksa memang itu, bukan BUYER.name. Longgar sengaja: sebagian tampilan
    // memotong atau menormalkan namanya.
    if (!/infarm/i.test(namaVA)) {
      const catatan =
        `Nama Virtual Account "${namaVA}" tak memuat nama merchant. Periksa xendit-2-va.png.`
      test.info().annotations.push({ type: 'catatan', description: catatan })
      console.log(`  ⚠ ${catatan}`)
    }

    // ================================================================
    // Langkah 10 — klik tautan simulasi pembayaran
    // ================================================================
    // ⛔ Tautan ini HANYA ada di lingkungan TEST Xendit. Di produksi tak ada, dan uji ini memang
    // tak boleh dijalankan di sana.
    //
    // ⛔ Klik ini yang memicu callback → status Lunas → BOOKING KURIR MENGANTAR (bila webhook
    // terjangkau). Titik paling mahal di seluruh berkas ini.
    // Xendit memberi tombol ini penanda uji sendiri:
    //   <button data-testid="simulate-button">Klik disini untuk simulasi pembayaran dengan BCA</button>
    //
    // `data-testid` didahulukan karena ia tak ikut berubah saat kalimatnya diterjemahkan, nama
    // banknya berganti, atau teksnya disunting. Pencocokan teks tetap disimpan sebagai cadangan
    // kalau penanda itu suatu saat dilepas.
    //
    // Ini `button`, BUKAN `link` — meski tampil bergaris bawah seperti tautan.
    const viaTestId = page.getByTestId('simulate-button')
    const viaTeks = page.getByRole('button', { name: SIMULATE_LINK_PATTERN }).first()
    const pemicuSimulasi = (await viaTestId.isVisible({ timeout: 10_000 }).catch(() => false))
      ? viaTestId
      : viaTeks

    await expect(
      pemicuSimulasi,
      'tombol simulasi pembayaran tak ditemukan — pastikan memakai kunci Xendit TEST ' +
        '(xnd_development_…). Kunci live tak menampilkan tombol ini sama sekali. ' +
        'Lihat tests/e2e/screenshots/xendit-2-va.png.',
    ).toBeVisible({ timeout: 15_000 })

    console.log('\n  ⛔ mengklik simulasi pembayaran — memicu callback & (bila terjangkau) booking kurir\n')

    // Tautannya bisa saja membuka TAB BARU. Kalau itu terjadi dan tak ditangani, `page` tetap
    // tertinggal di halaman VA dan langkah berikutnya menunggu 60 detik lalu gagal dengan sebab
    // yang menyesatkan ("tak pernah kembali dari Xendit"), padahal simulasinya berhasil di tab lain.
    const [tabBaru] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => null),
      pemicuSimulasi.click(),
    ])

    if (tabBaru) {
      console.log(`  simulasi terbuka di tab baru: ${tabBaru.url()}`)
      await tabBaru.waitForLoadState('domcontentloaded').catch(() => {})
    }

    // ================================================================
    // Langkah 11 — tunggu kembali ke domain kita
    // ================================================================
    // Xendit memulangkan pembeli ke `success_redirect_url` = /checkout/success?invoice=…
    // (lihat src/lib/xendit/invoice.ts). Sebagian alur menampilkan layar "pembayaran berhasil"
    // dulu dengan tombol kembali — ditangani dengan mengklik apa pun yang mengarah pulang.
    const kembali = page.getByRole('link', { name: /kembali|selesai|return|done/i }).first()
    if (await kembali.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await kembali.click()
    }

    // ⚠️ TUJUAN REDIRECT BELUM TENTU SAMA DENGAN baseURL.
    //
    // `resolveOrigin()` di src/app/api/payments/invoice/route.ts mendahulukan `NEXT_PUBLIC_SITE_URL`
    // di atas header host. Jadi bila uji dijalankan terhadap `https://xxx.vercel.app` sementara env
    // itu berisi domain kustom (mis. https://infarm.id), Xendit memulangkan pembeli ke DOMAIN
    // KUSTOM — bukan ke origin yang sedang diuji. Mencocokkan origin di sini akan gagal padahal
    // alurnya benar.
    //
    // Yang ditegakkan karena itu: sudah MENINGGALKAN domain Xendit, dan mendarat di
    // /checkout/success — origin mana pun.
    await page.waitForURL(
      (url) => !/xendit\.co/.test(url.hostname) && /\/checkout\/success/.test(url.pathname),
      { timeout: 60_000 },
    )

    const originPulang = new URL(page.url()).origin
    if (originPulang !== new URL(baseURL!).origin) {
      console.log(
        `  ⚠ dipulangkan ke ${originPulang}, bukan ${new URL(baseURL!).origin}\n` +
          `    Penyebab wajar: NEXT_PUBLIC_SITE_URL menunjuk domain kustom. Bukan kegagalan.`,
      )
    }

    // ================================================================
    // Langkah 12 — assert halaman sukses
    // ================================================================
    const isiSukses = (await page.locator('body').innerText()).replace(/\s+/g, ' ')

    const invoiceCocok = isiSukses.match(INVOICE_PATTERN)
    expect(
      invoiceCocok,
      `nomor invoice berformat INV-YYYYMMDD-XXXXXXXX tak ditemukan di halaman sukses. ` +
        `Isi halaman: "${isiSukses.slice(0, 300)}…"`,
    ).toBeTruthy()
    const nomorInvoice = invoiceCocok![0]

    // Ringkasan pesanan memuat produk yang dibeli. Dicocokkan dengan potongan nama (bukan nama
    // penuh): ringkasan bisa memotong nama panjang dengan elipsis.
    const potonganNama = namaProduk.split(/\s+/).slice(0, 2).join(' ')
    expect(
      isiSukses,
      `ringkasan pesanan tak menyebut produk yang dibeli ("${potonganNama}")`,
    ).toContain(potonganNama)

    await page.screenshot({
      path: 'tests/e2e/screenshots/checkout-full-success.png',
      fullPage: true,
    })

    // Tak boleh ada exception JS di halaman kita sendiri sepanjang alur.
    expect(ourPageErrors, 'ada exception JavaScript tak tertangkap di halaman aplikasi').toEqual([])

    // ================================================================
    // Laporan — yang kamu pakai untuk cek manual di Supabase
    // ================================================================
    // Status pembayaran SENGAJA tidak di-assert. Di localhost ia pasti masih "Menunggu" karena
    // webhook tak pernah tiba; memaksakan assertion di situ hanya menghasilkan uji merah yang
    // menyalahkan kode padahal penyebabnya jaringan.
    const statusTerlihat =
      isiSukses.match(/Menunggu Pembayaran|Pesanan Berhasil|Dibatalkan|Lunas|Diproses/)?.[0] ??
      '(tak terbaca)'

    const laporan = [
      '',
      '  ══════════════════════════════════════════════════════════',
      `  NOMOR INVOICE : ${nomorInvoice}`,
      '  ══════════════════════════════════════════════════════════',
      `  produk        : ${namaProduk}`,
      `  total         : Rp${totalCheckout.toLocaleString('id-ID')}`,
      `  ongkir        : Rp${ongkir.toLocaleString('id-ID')}`,
      `  VA            : ${nomorVA}`,
      `  telepon       : ${BUYER.phone}`,
      `  alamat        : ${alamatTerpilih}`,
      `  status di UI  : ${statusTerlihat}`,
      '',
      '  Cek manual di Supabase:',
      `    select nomor_invoice, status_pembayaran, order_status, no_tracking, shipment_status`,
      `    from orders where nomor_invoice = '${nomorInvoice}';`,
      '',
      isLocalhost
        ? '  ⚠ Dijalankan di localhost → webhook Xendit TAK BISA menjangkau server ini.\n' +
          '    status_pembayaran akan tetap "Menunggu", no_tracking KOSONG, booking kurir TAK terpicu.\n' +
          '    Itu perilaku yang benar, bukan bug. Pakai tunnel/preview untuk memverifikasinya.'
        : '  Webhook seharusnya terjangkau. Beri jeda beberapa detik sebelum query — callback,\n' +
          '    update status, dan booking kurir berjalan setelah redirect.',
      '  ══════════════════════════════════════════════════════════',
      '',
    ].join('\n')

    console.log(laporan)

    // Ikut disimpan sebagai anotasi supaya nomor invoicenya tetap ada di laporan HTML
    // (`npx playwright show-report`), bukan hanya melintas di terminal.
    test.info().annotations.push({ type: 'invoice', description: nomorInvoice })
    test.info().annotations.push({ type: 'laporan', description: laporan })
  })
})
