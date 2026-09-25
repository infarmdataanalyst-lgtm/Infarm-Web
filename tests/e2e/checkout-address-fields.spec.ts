// tests/e2e/checkout-address-fields.spec.ts
// E2E: pencarian alamat di /checkout mengisi otomatis provinsi, kota, kecamatan, kelurahan, kodepos.
//
// Berhenti SEBELUM pembayaran. Tak ada pesanan yang dibuat, tak ada stok yang dipotong, tak ada
// invoice Xendit yang terbit, tak ada booking kurir. Uji ini murni membaca.
//
// ── Kenapa cookie keranjang harus di-seed dulu ──
// /checkout membaca cookie `infarm_checkout`, BUKAN `infarm_cart`. Tanpa isi, halaman menampilkan
// keadaan kosong ("Belum ada produk untuk dibayar") dan form alamat tak pernah dirender — ujinya
// akan gagal pada hal yang sama sekali bukan yang sedang diuji.
//
// ── Kenapa produk diambil dari API, bukan di-hardcode ──
// Item cookie hanya dipetakan menjadi baris ringkasan bila id-nya benar-benar ada. Id karangan akan
// tersaring habis oleh `flatMap` di halaman checkout dan hasilnya sama saja: keadaan kosong.
//
// ── Ketergantungan jaringan ──
// Pencarian alamat menembak API Mengantar sungguhan (BACA, gratis). Uji ini karena itu ikut gagal
// bila Mengantar sedang bermasalah — konsekuensi yang disengaja: yang diuji memang integrasinya.

import { test, expect } from '@playwright/test'
import { addressSection, fillAddressSearch, openCheckoutWithCart } from './helpers/checkout'

const KEYWORD = 'jakarta pusat'

test.describe('Checkout — auto-isi wilayah dari pencarian alamat', () => {
  test('memilih hasil pencarian mengisi provinsi, kota, kecamatan, kelurahan, dan kode pos', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL wajib ada (lihat playwright.config.ts)').toBeTruthy()
    await openCheckoutWithCart(page, baseURL!)

    // === Ketik kata kunci ===
    // Helper mengulang pengisian sampai nilainya menempel — `fill` yang mendarat sebelum hidrasi
    // React selesai akan tertimpa state awal yang kosong, dan ujinya gagal berselang-seling.
    await fillAddressSearch(page, KEYWORD)

    // === Tunggu dropdown hasil ===
    // Panel memakai role listbox/option (lihat AddressSearchCombobox), jadi lokatornya semantik —
    // tak ikut rusak saat kelas Tailwind-nya diubah.
    //
    // Yang ditunggu OPSI PERTAMA, bukan kotak listbox-nya: panel sempat merender listbox kosong
    // di sela sebelum hasil datang.
    const listbox = page.getByRole('listbox')
    const firstOption = listbox.getByRole('option').first()
    await expect(firstOption).toBeVisible({ timeout: 15_000 })

    // Teks opsi berformat "Kelurahan, Kecamatan, Kota, Provinsi" (Title Case).
    // Dipakai sebagai sumber kebenaran hasil auto-isi: mencocokkan field dengan apa yang
    // BENAR-BENAR dipilih jauh lebih kuat daripada mencocokkan dengan tebakan "Jakarta".
    const optionText = ((await firstOption.textContent()) ?? '').trim()
    const [kelurahan, kecamatan, kota, provinsi] = optionText.split(',').map((s) => s.trim())

    expect(
      [kelurahan, kecamatan, kota, provinsi].every(Boolean),
      `format teks opsi tak dikenali: "${optionText}"`,
    ).toBeTruthy()

    await firstOption.click()

    // === Assert auto-isi ===
    // Kelima kolom read-only muncul setelah alamat terpilih (AddressForm → ReadOnlyField).
    await expect(page.getByLabel('Provinsi')).toHaveValue(provinsi)
    await expect(page.getByLabel('Kota/Kabupaten')).toHaveValue(kota)
    await expect(page.getByLabel('Kecamatan')).toHaveValue(kecamatan)
    await expect(page.getByLabel('Kelurahan')).toHaveValue(kelurahan)

    // Kode pos TIDAK ada di teks opsi, jadi hanya bentuknya yang bisa diperiksa: 5 digit.
    // Kosong berarti auto-isi gagal separuh — itu justru kasus yang paling perlu tertangkap,
    // karena checkout tetap terlihat normal sampai ongkir dihitung.
    await expect(page.getByLabel('Kode Pos')).toHaveValue(/^\d{5}$/)

    // Combobox pencarian digantikan ringkasan alamat + tombol "Ubah Alamat".
    await expect(page.getByRole('button', { name: 'Ubah Alamat' })).toBeVisible()

    // Memilih alamat otomatis membuka bottom sheet "Pilih Kurir Pengiriman" (ongkir langsung
    // dihitung). Ditutup dulu supaya screenshot memperlihatkan form alamatnya, bukan sheet yang
    // menutupi separuh layar. Menutup sheet TIDAK memilih kurir apa pun — alur berhenti di sini,
    // jauh sebelum pembayaran.
    // Screenshot dibatasi pada SECTION alamat, bukan seluruh halaman.
    //
    // Memilih alamat langsung memicu perhitungan ongkir, dan bottom sheet "Pilih Kurir Pengiriman"
    // terbuka menutupi separuh bawah layar. Menutupnya lebih dulu sempat dicoba dan tak bisa
    // diandalkan: BottomSheet TETAP ter-mount saat tertutup (hanya digeser lewat transform +
    // pointer-events-none), sehingga pemeriksaan "sudah tersembunyi?" lolos padahal sheet-nya masih
    // terlihat di gambar.
    //
    // Membingkai section-nya juga lebih tepat sasaran: bukti yang dicari adalah kelima kolom
    // wilayah terisi, bukan keadaan seluruh halaman.
    await addressSection(page).screenshot({
      path: 'tests/e2e/screenshots/field-completeness.png',
    })
  })
})
