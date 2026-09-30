// src/lib/payment-method.ts
// Menerjemahkan isi kolom `orders.metode_pembayaran` menjadi label yang bisa dibaca admin OMS.
// Murni — tanpa I/O, aman diimpor dari komponen 'use client' maupun Route Handler.
//
// ── Kenapa ini penting bagi CS, bukan sekadar hiasan ──
// Cara pembeli membayar menentukan BAGAIMANA uangnya bisa dikembalikan saat pesanan dibatalkan,
// dan kedua jalurnya sangat berbeda:
//
//   Transfer bank / VA  → Xendit TIDAK BISA me-refund-nya sama sekali (terverifikasi di help
//                         center mereka). Uang hanya bisa kembali lewat transfer BARU ke rekening
//                         pembeli — artinya CS wajib meminta nomor rekening lewat chat.
//   E-wallet/QRIS/kartu → bisa dikembalikan ke sumbernya, dengan batas waktu berbeda per channel
//                         (OVO 14 hari, DANA/LinkAja/QRIS 30, GoPay 45, ShopeePay & kartu 365).
//
// Sampai 2026-09-10 nilai ini TIDAK PERNAH ditampilkan di OMS mana pun — tersimpan rapi di
// database, tak terlihat siapa pun. Akibatnya CS tak punya cara membedakan kedua jalur itu tanpa
// membuka database, padahal itu pertanyaan PERTAMA yang menentukan seluruh langkah berikutnya.
//
// ── Kenapa 'lain' dan null dibedakan ──
// `null` berarti KITA TIDAK TAHU (pesanan sebelum kolomnya ada, atau callback tanpa field itu),
// bukan "bukan salah satu di atas". Menebaknya sebagai transfer bank akan menyuruh CS meminta
// nomor rekening untuk pembayaran yang mungkin sebenarnya e-wallet — dan sebaliknya. Kalau tak
// tahu, katakan tak tahu.

// Keluarga metode pembayaran. Dipakai untuk pelabelan; keputusan soal refund TIDAK dikodekan di
// sini karena bergantung pada channel spesifik dan batas waktunya, bukan sekadar keluarganya.
//
// 'direct-debit' (mis. BRI) DIPISAH dari 'transfer-bank' walau sama-sama rekening bank: direct
// debit BISA dikembalikan ke rekening asal lewat POST /refunds (BRI: penuh, maks. 120 hari),
// sementara VA/transfer bank tidak bisa sama sekali. Menyatukannya akan menyembunyikan tombol
// refund otomatis untuk pembayaran yang sebenarnya bisa dikembalikan.
export type PaymentFamily =
  | 'transfer-bank'
  | 'direct-debit'
  | 'e-wallet'
  | 'qris'
  | 'kartu'
  | 'gerai'
  | 'paylater'
  | 'lain'

// Channel Xendit → keluarga. Kunci disimpan KAPITAL; pencocokan meng-uppercase masukannya lebih
// dulu, jadi 'bca' dan 'BCA' sama saja.
//
// ── Dua generasi kode kanal, satu tabel ──
// Invoice API v2 (dilepas 2026-09-28) menulis `payment_channel` pendek: 'BCA', 'OVO'. Payments
// API v3 menulis `channel_code` panjang: 'BCA_VIRTUAL_ACCOUNT', 'BRI_DIRECT_DEBIT', dan untuk
// e-wallet kadang berawalan negara: 'ID_SHOPEEPAY' (terukur di callback refund 2026-09-14).
// normalizeChannelKey() melucuti awalan/akhiran itu sebelum mencocokkan, jadi tabel ini cukup
// memuat nama pendeknya dan pesanan lama maupun baru terbaca dengan cara yang sama.
//
// Daftar ini sengaja memuat channel yang BELUM tentu kita nyalakan (GoPay, Kredivo…). Menyalakan
// satu metode baru di dashboard Xendit tak seharusnya menuntut perubahan kode di sini — dan kalau
// daftarnya cuma memuat yang aktif hari ini, metode baru akan muncul sebagai 'lain' tepat pada
// hari pertama ia dipakai pembeli sungguhan.
const CHANNEL_FAMILY: Record<string, PaymentFamily> = {
  // Transfer bank / Virtual Account
  BCA: 'transfer-bank',
  BNI: 'transfer-bank',
  BRI: 'transfer-bank',
  MANDIRI: 'transfer-bank',
  PERMATA: 'transfer-bank',
  BJB: 'transfer-bank',
  BSI: 'transfer-bank',
  CIMB: 'transfer-bank',
  BNC: 'transfer-bank',
  BTN: 'transfer-bank',
  DANAMON: 'transfer-bank',
  SAHABAT_SAMPOERNA: 'transfer-bank',
  BSS: 'transfer-bank',
  HANA: 'transfer-bank',
  MUAMALAT: 'transfer-bank',
  BANK_TRANSFER: 'transfer-bank',
  VIRTUAL_ACCOUNT: 'transfer-bank',

  // Direct debit (kunci hasil normalisasi 'BRI_DIRECT_DEBIT' → 'DD_BRI', lihat normalizeChannelKey)
  DD_BRI: 'direct-debit',
  DD_MANDIRI: 'direct-debit',
  DD_BCA: 'direct-debit',
  DIRECT_DEBIT: 'direct-debit',

  // Dompet digital
  OVO: 'e-wallet',
  DANA: 'e-wallet',
  LINKAJA: 'e-wallet',
  SHOPEEPAY: 'e-wallet',
  GOPAY: 'e-wallet',
  ASTRAPAY: 'e-wallet',
  JENIUSPAY: 'e-wallet',
  NEXCASH: 'e-wallet',
  EWALLET: 'e-wallet',

  // QRIS
  QRIS: 'qris',
  QR_CODE: 'qris',

  // Kartu
  CREDIT_CARD: 'kartu',
  CARDS: 'kartu',

  // Gerai ritel
  ALFAMART: 'gerai',
  INDOMARET: 'gerai',
  RETAIL_OUTLET: 'gerai',

  // Bayar nanti
  KREDIVO: 'paylater',
  INDODANA: 'paylater',
  AKULAKU: 'paylater',
  ATOME: 'paylater',
  UANGME: 'paylater',
  PAYLATER: 'paylater',
}

const FAMILY_LABEL: Record<PaymentFamily, string> = {
  'transfer-bank': 'Transfer Bank',
  'direct-debit': 'Direct Debit',
  'e-wallet': 'Dompet Digital',
  qris: 'QRIS',
  kartu: 'Kartu',
  gerai: 'Gerai Ritel',
  paylater: 'Bayar Nanti',
  lain: 'Lainnya',
}

// Nama channel yang enak dibaca. Hanya untuk yang ejaannya berbeda dari bentuk kapitalnya;
// sisanya ditampilkan apa adanya (BCA, BNI, OVO, DANA sudah benar sebagai kapital).
const CHANNEL_LABEL: Record<string, string> = {
  LINKAJA: 'LinkAja',
  SHOPEEPAY: 'ShopeePay',
  GOPAY: 'GoPay',
  ASTRAPAY: 'AstraPay',
  JENIUSPAY: 'JeniusPay',
  NEXCASH: 'NexCash',
  BANK_TRANSFER: 'Transfer Bank',
  VIRTUAL_ACCOUNT: 'Virtual Account',
  CREDIT_CARD: 'Kartu Kredit',
  RETAIL_OUTLET: 'Gerai Ritel',
  QR_CODE: 'QRIS',
  EWALLET: 'Dompet Digital',
  SAHABAT_SAMPOERNA: 'Sahabat Sampoerna',
  BSS: 'Sahabat Sampoerna',
  BNC: 'Neo Commerce',
  HANA: 'Hana Bank',
  MUAMALAT: 'Muamalat',
  DD_BRI: 'BRI',
  DD_MANDIRI: 'Mandiri',
  DD_BCA: 'BCA',
  DIRECT_DEBIT: 'Direct Debit',
  ALFAMART: 'Alfamart',
  INDOMARET: 'Indomaret',
  KREDIVO: 'Kredivo',
  INDODANA: 'Indodana',
  AKULAKU: 'Akulaku',
  ATOME: 'Atome',
  UANGME: 'UangMe',
}

export type PaymentMethodInfo = {
  /** Nama channel siap tampil, mis. 'BCA' atau 'LinkAja'. */
  channel: string
  family: PaymentFamily
  /** Nama keluarga siap tampil, mis. 'Transfer Bank'. */
  familyLabel: string
}

// null = kolomnya kosong, ATAU berisi teks yang tak bisa dibaca sebagai channel.
//
// Pemanggil WAJIB menangani null sebagai "belum tercatat", bukan menyembunyikan barisnya. Metode
// bayar yang tak tercatat adalah informasi tersendiri bagi CS: ia berarti jalur pengembalian
// dananya harus dipastikan lewat dashboard Xendit lebih dulu, bukan diasumsikan.
export function paymentMethodInfo(value: string | null | undefined): PaymentMethodInfo | null {
  const raw = value?.trim()
  if (!raw) return null

  const key = normalizeChannelKey(raw)
  const family = CHANNEL_FAMILY[key] ?? 'lain'

  return {
    channel: CHANNEL_LABEL[key] ?? key,
    family,
    familyLabel: FAMILY_LABEL[family],
  }
}

// Kunci tabel dari nilai kolom apa pun bentuknya. Diekspor untuk unit test.
//
//   'bca'                 → 'BCA'
//   'BCA_VIRTUAL_ACCOUNT' → 'BCA'        (akhiran v3 dilucuti; keluarganya sudah jelas dari bank)
//   'BRI_DIRECT_DEBIT'    → 'DD_BRI'     (dibedakan dari VA BRI — jalur refund-nya berbeda)
//   'ID_SHOPEEPAY'        → 'SHOPEEPAY'  (awalan negara di callback e-wallet)
//   'ID_DANA_AUTODEBIT'   → 'DANA'       (varian autodebit dompet digital)
export function normalizeChannelKey(raw: string): string {
  let key = raw.toUpperCase().replace(/[\s-]+/g, '_')
  key = key.replace(/^ID_/, '')
  if (key.endsWith('_DIRECT_DEBIT')) return `DD_${key.slice(0, -'_DIRECT_DEBIT'.length)}`
  key = key.replace(/_VIRTUAL_ACCOUNT$/, '').replace(/_AUTODEBIT$/, '')
  return key
}

// Satu baris siap tampil: 'BCA · Transfer Bank'.
//
// Dua hal yang sengaja TIDAK ditambahi keluarga:
//   - channel tak dikenal → '· Lainnya' hanya menambah kata tanpa menambah keterangan
//   - channel yang namanya SAMA dengan keluarganya → 'QRIS · QRIS' dan
//     'Transfer Bank · Transfer Bank' terbaca seperti kesalahan tampilan, bukan informasi.
//     Ini muncul pada nilai KATEGORI (BANK_TRANSFER, EWALLET, QR_CODE) yang tersimpan saat
//     Xendit tidak mengirim `payment_channel` spesifiknya.
export function paymentMethodLabel(value: string | null | undefined): string | null {
  const info = paymentMethodInfo(value)
  if (!info) return null
  if (info.family === 'lain' || info.channel === info.familyLabel) return info.channel
  return `${info.channel} · ${info.familyLabel}`
}
