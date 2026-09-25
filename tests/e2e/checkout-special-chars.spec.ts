// tests/e2e/checkout-special-chars.spec.ts
// E2E: pencarian alamat tahan terhadap kata kunci "kotor" — kutip satu, kutip dua, RT/RW, spasi
// ganda. Yang diuji BUKAN apakah alamatnya ketemu (itu urusan data Mengantar), melainkan bahwa
// aplikasi tak pecah dan tetap memberi keadaan yang masuk akal.
//
// Kenapa penting: kata kunci semacam ini lahir dari cara orang benar-benar menulis alamat
// ("RT 05 RW 02 …", "RT'05"), dan keyword masuk ke URL query ke API pihak ketiga. Kutip yang tak
// ter-encode, spasi ganda yang runtuh, atau respons kosong yang tak tertangani semuanya berujung
// sama bagi pembeli: kotak pencarian yang diam atau halaman error di tengah checkout.
//
// Berhenti jauh sebelum pembayaran. Tak ada pesanan, tak ada stok terpotong, tak ada invoice.

import { test, expect, type Page } from '@playwright/test'
import { addressSection, fillAddressSearch, openCheckoutWithCart } from './helpers/checkout'

type Scenario = {
  no: number
  title: string
  keyword: string
}

const SCENARIOS: Scenario[] = [
  { no: 1, title: 'tanda kutip satu', keyword: "RT'05 Jakarta" },
  { no: 2, title: 'tanda kutip dua', keyword: 'RT"05 Jakarta' },
  { no: 3, title: 'format RT/RW', keyword: 'RT 05 RW 02 Kebayoran' },
  { no: 4, title: 'spasi ganda', keyword: 'jakarta  pusat' },
]

// Teks yang menandakan sesuatu benar-benar rusak, bukan sekadar "tak ada hasil".
// `Alamat tidak ditemukan` SENGAJA tidak masuk daftar — itu jawaban yang sah.
const BROKEN_TEXT = /gagal|error|terjadi kesalahan|something went wrong|unhandled|terlalu banyak/i

// Menunggu pencarian selesai: entah daftar hasil muncul, atau pesan "tidak ditemukan".
//
// Keduanya diterima. Uji ini menilai KETAHANAN, bukan kelengkapan data Mengantar — memaksa harus
// ada hasil akan membuat uji gagal karena alasan di luar kendali kita (mis. Mengantar memang tak
// mengenal "RT'05").
// ⚠️ Yang ditunggu OPSI PERTAMA, bukan kotak listbox-nya.
//
// Panel sempat merender `<ul role="listbox">` KOSONG di sela antara ketikan dan berakhirnya
// debounce: pada saat itu belum loading, belum ada hasil, dan belum pernah menjawab — jadi cabang
// "Alamat tidak ditemukan" pun belum aktif. Menunggu listbox saja akan langsung terpenuhi oleh
// kotak kosong itu, dan uji menyimpulkan "ada hasil" sebelum pencarian benar-benar jalan.
async function waitForSearchOutcome(page: Page): Promise<'ada-hasil' | 'tidak-ditemukan'> {
  const firstOption = page.getByRole('listbox').getByRole('option').first()
  // Dicocokkan sebagian, bukan `exact`: di bawah kalimat ini ada baris petunjuk ("coba ketik nama
  // kelurahan…") yang boleh berubah kata-katanya tanpa membuat uji ini gagal.
  const notFound = page.getByText('Alamat tidak ditemukan')

  await expect(firstOption.or(notFound)).toBeVisible({ timeout: 15_000 })
  return (await firstOption.isVisible()) ? 'ada-hasil' : 'tidak-ditemukan'
}

test.describe('Checkout — pencarian alamat dengan karakter khusus', () => {
  for (const scenario of SCENARIOS) {
    test(`skenario ${scenario.no}: ${scenario.title} — "${scenario.keyword}"`, async ({
      page,
      baseURL,
    }) => {
      expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()

      // Exception JavaScript yang tak tertangkap dikumpulkan lebih dulu, sebelum halaman dibuka.
      // Ini penjaga "tidak crash" yang sebenarnya: halaman bisa saja masih terlihat normal
      // sementara satu handler diam-diam melempar dan pencarian berhenti bekerja.
      const pageErrors: string[] = []
      page.on('pageerror', (err) => pageErrors.push(err.message))

      await openCheckoutWithCart(page, baseURL!)

      // Diisi sekali jalan (bukan per karakter) supaya hanya SATU permintaan yang terpicu setelah
      // debounce; mengetik huruf demi huruf menembakkan beberapa pencarian parsial dan membuat
      // hasil akhirnya bergantung pada balapan antar respons.
      //
      // Helper mengulang pengisian sampai nilainya menempel — sekaligus menegaskan nilai di input
      // utuh apa adanya: kutip tak ter-escape, spasi ganda tak diringkas.
      await fillAddressSearch(page, scenario.keyword)

      const outcome = await waitForSearchOutcome(page)

      // === Tidak rusak ===
      await expect(
        page.getByRole('heading', { name: 'Alamat Pengiriman' }),
        'form alamat hilang — halaman kemungkinan pecah',
      ).toBeVisible()

      await expect(
        addressSection(page).getByText(BROKEN_TEXT),
        `pesan kegagalan muncul untuk keyword "${scenario.keyword}"`,
      ).toHaveCount(0)

      expect(
        pageErrors,
        `ada exception JavaScript tak tertangkap untuk keyword "${scenario.keyword}"`,
      ).toEqual([])

      // Dicatat supaya terlihat di keluaran: keyword mana yang menghasilkan apa. Berguna saat
      // Mengantar mengubah perilaku pencariannya.
      console.log(`  skenario ${scenario.no} "${scenario.keyword}" → ${outcome}`)

      await addressSection(page).screenshot({
        path: `tests/e2e/screenshots/special-chars-${scenario.no}.png`,
      })
    })
  }
})
