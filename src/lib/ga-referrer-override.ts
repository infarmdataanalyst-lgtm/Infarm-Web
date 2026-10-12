// src/lib/ga-referrer-override.ts
// Menghapus Xendit dari atribusi GA4 saat pembeli dipulangkan dari halaman bayar.
//
// ── Masalahnya ──
// Setelah membayar (atau batal), Xendit memulangkan pembeli ke /checkout/success. Browser membawa
// perujuk `checkout(-staging).xendit.co`, dan laporan Akuisisi traffic mencatat sesi itu sebagai
// `checkout-staging.xendit.co / referral` — kanal palsu yang "mendatangkan" pembelian.
//
// ── Kenapa setelan GA4 saja tidak cukup (terukur 12 Okt 2026) ──
// Aturan "rujukan yang tidak diinginkan" (domain berisi xendit.co / xen.to) SUDAH terpasang dan
// SUDAH sampai ke browser: gtag.js memuat `__ogt_referral_exclusion`, dan setiap hit di halaman
// success membawa `ir=1` dalam sesi yang sama (sct=1, tanpa _ss). Meski begitu, data harian final
// GA4 tetap mengatribusikan sesinya ke Xendit. Bagian yang salah ada di pemrosesan Google — di luar
// kendali kita — jadi perujuknya dibuang sebelum terkirim.
//
// ── Caranya ──
// Skrip inline di root layout berjalan SAAT HTML diurai, sebelum skrip GA (`afterInteractive`).
// Bila perujuknya domain pembayaran, ia mengantrekan `gtag('set', { page_referrer })` ke dataLayer
// dengan URL /checkout toko sendiri. GA4 memperlakukan perujuk berdomain sama sebagai perpindahan
// halaman biasa, jadi sumber sesi pembeli (Instagram, Google, dst.) tetap utuh. Perujuk lain tak
// disentuh sama sekali.
//
// Daftar domain di bawah SAMA dengan setelan GA4 Admin → Aliran data → Konfigurasi setelan tag →
// Cantumkan rujukan yang tidak diinginkan. Ubah keduanya bersamaan.

export const PAYMENT_REFERRER_DOMAINS = ['xendit.co', 'xen.to'] as const

// Halaman toko yang dipakai sebagai perujuk pengganti: tempat pembeli berangkat ke Xendit.
export const REFERRER_OVERRIDE_PATH = '/checkout'

// Badan skrip inline. Ditulis sebagai JavaScript ES5 polos karena dieksekusi apa adanya oleh browser
// (tak lewat bundler), dan dibungkus try/catch: skrip analytics tak boleh pernah merusak halaman.
// Pencocokan host KETAT — sama persis atau subdomain — supaya `xendit.co.situs-lain.com` atau
// `notxendit.co` tak ikut kehilangan atribusinya.
export function buildReferrerOverrideScript(): string {
  const domains = JSON.stringify(PAYMENT_REFERRER_DOMAINS)
  const path = JSON.stringify(REFERRER_OVERRIDE_PATH)
  // `gtag` di sini lokal — perintahnya harus didorong sebagai objek `arguments` (bukan array),
  // persis seperti fungsi gtag yang dipasang @next/third-parties, supaya gtag.js memprosesnya.
  return [
    '(function(){try{',
    'var r=document.referrer;if(!r)return;',
    'var h=new URL(r).hostname.toLowerCase();',
    `var d=${domains};`,
    'for(var i=0;i<d.length;i++){',
    "if(h===d[i]||h.slice(-(d[i].length+1))==='.'+d[i]){",
    'window.dataLayer=window.dataLayer||[];',
    'var gtag=function(){window.dataLayer.push(arguments);};',
    `gtag('set',{page_referrer:location.origin+${path}});`,
    'return;}}',
    '}catch(e){}})();',
  ].join('')
}
