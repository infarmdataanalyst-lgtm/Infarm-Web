// src/lib/meta-cookies.ts
// Membaca penanda Meta Pixel dari cookie di browser: `_fbp` (pengenal browser yang ditulis pixel)
// dan `_fbc` (pengenal klik iklan, ditulis pixel saat pengunjung tiba dengan ?fbclid=…).
//
// Dipakai checkout untuk menitipkan keduanya ke pesanan — padanan persis lib/ga-client-id.ts untuk
// GA4. Webhook Xendit lalu mengirim event `Purchase` lewat Conversions API atas nama browser ini
// (lib/meta-capi.ts). Tanpa `_fbc`, Meta tak bisa menyambungkan pembelian ke IKLAN yang diklik;
// tanpa `_fbp`, ia tak bisa menyambungkannya ke pengunjung yang pixel-nya sudah lihat.
//
// ── Bentuk cookie ──
//   _fbp = fb.<subdomain-index>.<stempel-waktu-ms>.<angka-acak>      mis. fb.1.1696000000000.1234567890
//   _fbc = fb.<subdomain-index>.<stempel-waktu-ms>.<fbclid>          mis. fb.1.1696000000000.IwAR0abc…
//
// Bentuk ini didokumentasikan Meta untuk Conversions API, tapi tetap DIVALIDASI: nilainya kelak
// terkirim ke Meta atas nama toko ini, dan Meta menerima string apa pun tanpa mengeluh. Bentuk
// yang tak dikenali = "tidak ada", bukan dilempar — proses bayar tak boleh jatuh karena cookie.

// `fbclid` berisi huruf, angka, '_' dan '-'. Panjang dibatasi: cookie sungguhan jauh di bawah 255.
const META_COOKIE_RE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,200}$/

// Validasi NILAI cookie `_fbp`/`_fbc`. Fungsi murni supaya bisa diuji tanpa browser.
export function parseMetaCookie(value: string): string | undefined {
  const v = value.trim()
  return META_COOKIE_RE.test(v) ? v : undefined
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  for (const bagian of document.cookie.split(';')) {
    const isi = bagian.trim()
    if (!isi.startsWith(`${name}=`)) continue
    try {
      return parseMetaCookie(decodeURIComponent(isi.slice(name.length + 1)))
    } catch {
      // decodeURIComponent melempar pada persentase tak lengkap. Cookie rusak = tak ada penanda.
      return undefined
    }
  }
  return undefined
}

// undefined bila pixel tak terpasang, cookie diblokir, atau dipanggil di server.
export function readMetaFbp(): string | undefined {
  return readCookie('_fbp')
}

// undefined bila pengunjung tak datang dari iklan Meta (kasus paling umum) atau cookie diblokir.
export function readMetaFbc(): string | undefined {
  return readCookie('_fbc')
}
