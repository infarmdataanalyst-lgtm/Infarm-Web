// src/lib/order-issues.ts
// Aturan "pesanan mana yang PERLU TINDAKAN manusia". Murni — tanpa I/O, tanpa jam sistem
// (nowMs disuntikkan) — supaya bisa diuji tanpa database dan dipakai dari server maupun klien.
//
// ── Kenapa daftar ini ada ──
// Sampai 23 Sep 2026 semua keadaan di bawah SUDAH tercatat di kolom `orders` (shipment_status,
// refund_status, invoice_expire_error, …), tapi tak satu pun dikumpulkan di satu tempat. Admin
// hanya melihatnya kalau kebetulan membuka halaman Pesanan dan menggulir ke barisnya. MGT-66
// adalah contohnya: penjemputan kurir yang gagal dihapus menunggu di kolom galat sampai ada yang
// membacanya, sementara kurir tetap datang dan saldo Mengantar tertahan.
//
// ── Kriterianya: ada tindakan manusia yang ditunggu, dan sistem tak bisa melakukannya sendiri ──
// Yang SENGAJA tidak masuk: pesanan baru, pembayaran masuk, status yang berpindah normal. Itu
// informasi, bukan tugas, dan sudah punya tempatnya di daftar pesanan. Pemberitahuan berguna
// selama ia jarang — kalau kabar normal ikut berbunyi, admin belajar mengabaikan semuanya,
// termasuk yang menyangkut uang.
//
// ── Dua aturan agar tetap dipercaya ──
//   1. Hilang sendiri begitu selesai. Semua kriteria dihitung dari KEADAAN, bukan peristiwa, jadi
//      begitu kolomnya berubah (penjemputan terhapus, refund dicatat), pesanannya lenyap dari
//      daftar tanpa ada yang perlu "menutup" apa pun.
//   2. Tak bisa dibungkam. Tak ada tombol abaikan. Kalau suatu keadaan memang tak perlu ditindak,
//      yang salah adalah kriterianya — dan itu yang diperbaiki di berkas ini.

export type OrderIssueKind =
  | 'penjemputan_belum_dihapus' // shipment_status CANCEL_FAILED — kurir tetap datang, saldo tertahan
  | 'booking_gagal' // shipment_status FAILED — sudah dibayar, kurir belum dibooking
  | 'lunas_tanpa_resi' // lunas, tak ada resi, tak ada tanda FAILED — webhook/booking macet diam-diam
  | 'tagihan_masih_hidup' // dibatalkan tapi tagihan Xendit gagal dimatikan — masih bisa dibayar
  | 'perlu_refund' // uang pembeli masih di kita
  | 'diproses_terlalu_lama' // resi ada tapi kurir tak kunjung memindai paket

// Berapa lama pesanan lunas boleh tanpa resi sebelum dianggap macet (keputusan pemilik 23 Sep 2026).
//
// Booking kurir berjalan di dalam webhook Xendit, jadi normalnya resi terbit dalam hitungan detik
// setelah bayar. 15 menit berada di luar jeda wajar webhook Xendit (1–3 menit) dan Vercel yang
// "dingin", sehingga alarm yang muncul hampir pasti sungguhan — dan masih menyisakan waktu sebelum
// slot penjemputan hari ini ditutup pukul 15.30. Lebih pendek (5 menit) memunculkan alarm yang
// hilang sendiri sebelum admin sempat membukanya; lebih panjang (60 menit) terlalu sering melewati
// tenggat 15.30.
export const LUNAS_TANPA_RESI_MENIT = 15

// Berapa hari sejak resi terbit sebelum paket yang belum dipindai kurir dianggap tak bergerak
// (keputusan pemilik 23 Sep 2026).
//
// Ini soal paket FISIK: kurir tak datang, paket belum diserahkan, atau salah gudang (MGT-57).
// Tak ada satu pun yang bisa dideteksi selain lewat waktu. 2 hari cukup longgar untuk akhir pekan
// dan kurir yang terlambat sehari; paket yang benar-benar terlupakan ketahuan di hari ketiga.
export const DIPROSES_TERLALU_LAMA_HARI = 2

// Bentuk minimum yang dibutuhkan penilaian — nama kolom DB apa adanya supaya bisa dipakai langsung
// pada baris hasil query tanpa dipetakan dulu ke Order.
export type OrderIssueInput = {
  order_status: string | null
  status_pembayaran: string | null
  no_tracking: string | null
  shipment_status?: string | null
  shipment_booked_at?: string | null
  refund_status?: string | null
  invoice_expire_error?: string | null
  invoice_expired_at?: string | null
  created_at: string
}

const MENIT_MS = 60_000
const HARI_MS = 24 * 60 * MENIT_MS

function umurMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? nowMs - t : null
}

// Menilai SATU pesanan. null = tak ada yang perlu ditindak.
//
// Urutannya disengaja: bila satu pesanan memenuhi beberapa kriteria sekaligus, yang dilaporkan
// adalah yang paling mendesak menurut uang & kurir. Satu pesanan = satu baris di daftar tindakan,
// supaya hitungannya sama dengan jumlah pesanan yang harus dibuka admin.
export function classifyOrderIssue(row: OrderIssueInput, nowMs: number): OrderIssueKind | null {
  const dibatalkan = row.order_status === 'CANCELLED'
  const diproses = row.order_status === 'PROCESSING'
  const lunas = row.status_pembayaran === 'PAID'
  const punyaResi = Boolean(row.no_tracking?.trim())

  // 1. Penjemputan kurir masih hidup untuk pesanan yang sudah batal — kurir datang, stok sudah
  //    dikembalikan, saldo Mengantar tertahan. Paling mahal dan paling senyap (MGT-66).
  if (row.shipment_status === 'CANCEL_FAILED') return 'penjemputan_belum_dihapus'

  // 2. Sudah dibayar, booking kurir gagal dan tercatat. Pesanan tersangkut sampai dibooking ulang.
  //    Hanya untuk pesanan yang masih berjalan — yang sudah batal tak butuh kurir lagi.
  if (row.shipment_status === 'FAILED' && !dibatalkan) return 'booking_gagal'

  // 3. Sudah dibayar, tak ada resi, dan TIDAK ada tanda FAILED: booking tak pernah tercatat gagal
  //    karena memang tak pernah berjalan (webhook Xendit tak sampai) atau terputus di tengah.
  //    Inilah kegagalan yang paling sunyi — tak ada satu pun kolom galat yang terisi.
  if (lunas && diproses && !punyaResi && row.shipment_status !== 'FAILED') {
    const umur = umurMs(row.created_at, nowMs)
    if (umur !== null && umur >= LUNAS_TANPA_RESI_MENIT * MENIT_MS) return 'lunas_tanpa_resi'
  }

  // 4. Pesanan batal tapi tagihan Xendit gagal dimatikan → pembeli masih bisa membayar pesanan
  //    yang sudah tidak ada. Untuk transfer bank, uang itu bahkan tak bisa dikembalikan lewat Xendit.
  if (dibatalkan && row.invoice_expire_error && !row.invoice_expired_at) return 'tagihan_masih_hidup'

  // 5. Uang pembeli masih di kita. SEDANG_DIPROSES ikut: tugasnya belum selesai sampai tercatat
  //    SUDAH_REFUND, dan justru yang "sedang diproses" paling mudah terlupakan di tengah jalan.
  if (row.refund_status === 'PERLU_REFUND' || row.refund_status === 'SEDANG_DIPROSES') {
    return 'perlu_refund'
  }

  // 6. Resi sudah terbit tapi status tak pernah naik ke Dikirim → kurir belum memindai paket.
  //    Diukur dari shipment_booked_at, bukan created_at: yang ditunggu adalah penjemputan, dan
  //    jamnya baru berjalan sejak kurir punya perintah jemput.
  if (diproses && lunas && punyaResi) {
    const umur = umurMs(row.shipment_booked_at, nowMs)
    if (umur !== null && umur >= DIPROSES_TERLALU_LAMA_HARI * HARI_MS) return 'diproses_terlalu_lama'
  }

  return null
}

// Label & tujuan tiap jenis. `href` menunjuk ke daftar yang SUDAH tersaring ke pesanan bermasalah
// itu saja — bukan ke daftar umum yang memaksa admin mencari sendiri.
export type OrderIssueMeta = {
  kind: OrderIssueKind
  label: string // singular, untuk judul notifikasi
  labelJamak: (n: number) => string // untuk kotak ringkasan
  tindakan: string // apa yang harus dilakukan admin
  href: string
}

export const ORDER_ISSUE_META: Record<OrderIssueKind, OrderIssueMeta> = {
  penjemputan_belum_dihapus: {
    kind: 'penjemputan_belum_dihapus',
    label: 'Penjemputan kurir belum dihapus',
    labelJamak: (n) => `${n} penjemputan kurir belum dihapus`,
    tindakan: 'Tekan "Coba hapus lagi" di kolom No. Resi; bila Mengantar menolak, hapus manual di dashboard Mengantar lalu tandai.',
    href: '/oms/dashboard/orders?masalah=penjemputan_belum_dihapus',
  },
  booking_gagal: {
    kind: 'booking_gagal',
    label: 'Booking kurir gagal',
    labelJamak: (n) => `${n} pesanan lunas gagal dibooking ke kurir`,
    tindakan: 'Periksa pesan galat di kolom No. Resi, lalu booking ulang.',
    href: '/oms/dashboard/orders?masalah=booking_gagal',
  },
  lunas_tanpa_resi: {
    kind: 'lunas_tanpa_resi',
    label: 'Lunas tapi belum ada resi',
    labelJamak: (n) => `${n} pesanan lunas belum punya resi setelah ${LUNAS_TANPA_RESI_MENIT} menit`,
    tindakan: 'Booking kurir tidak pernah berjalan. Periksa log webhook Xendit, lalu booking manual.',
    href: '/oms/dashboard/orders?masalah=lunas_tanpa_resi',
  },
  tagihan_masih_hidup: {
    kind: 'tagihan_masih_hidup',
    label: 'Tagihan Xendit masih bisa dibayar',
    labelJamak: (n) => `${n} pesanan batal yang tagihannya masih bisa dibayar`,
    tindakan: 'Matikan tagihannya manual di dashboard Xendit sebelum pembeli terlanjur membayar.',
    href: '/oms/dashboard/orders?masalah=tagihan_masih_hidup',
  },
  perlu_refund: {
    kind: 'perlu_refund',
    label: 'Perlu pengembalian dana',
    labelJamak: (n) => `${n} pesanan menunggu pengembalian dana`,
    tindakan: 'Selesaikan di halaman Pengembalian Dana.',
    href: '/oms/dashboard/refund',
  },
  diproses_terlalu_lama: {
    kind: 'diproses_terlalu_lama',
    label: 'Paket belum dijemput kurir',
    labelJamak: (n) => `${n} paket belum dijemput kurir lebih dari ${DIPROSES_TERLALU_LAMA_HARI} hari`,
    tindakan: 'Pastikan paketnya ada di gudang yang tercatat dan kurir memang datang; bila perlu jadwalkan ulang.',
    href: '/oms/dashboard/orders?masalah=diproses_terlalu_lama',
  },
}

// Urutan tampil: menurut uang & kurir, sama dengan urutan di classifyOrderIssue.
export const ORDER_ISSUE_ORDER: OrderIssueKind[] = [
  'penjemputan_belum_dihapus',
  'booking_gagal',
  'lunas_tanpa_resi',
  'tagihan_masih_hidup',
  'perlu_refund',
  'diproses_terlalu_lama',
]

export function isOrderIssueKind(value: unknown): value is OrderIssueKind {
  return typeof value === 'string' && value in ORDER_ISSUE_META
}

// Penyaringan KASAR di database sebelum classifyOrderIssue menilai tiap baris — sintaks `.or()`
// PostgREST. Hanya pesanan yang sedang berjalan atau yang meninggalkan jejak galat yang ditarik;
// pesanan selesai dan batal-bersih tak pernah ikut. Kriteria yang bergantung waktu (15 menit,
// 2 hari) sengaja tak ditulis di sini: itu urusan JS, supaya ambangnya hidup di SATU tempat.
//
// Dipakai dua pemanggil (mock-db/order-issues.ts & readOrdersFiltered) dan WAJIB tetap satu
// konstanta: kalau keduanya menyaring kandidat berbeda, kotak "Perlu tindakan" bisa menghitung
// pesanan yang tak muncul saat tautannya diklik.
export const ORDER_ISSUE_CANDIDATE_FILTER =
  'shipment_status.in.(CANCEL_FAILED,FAILED),' +
  'refund_status.in.(PERLU_REFUND,SEDANG_DIPROSES),' +
  'invoice_expire_error.not.is.null,' +
  'order_status.eq.PROCESSING'
