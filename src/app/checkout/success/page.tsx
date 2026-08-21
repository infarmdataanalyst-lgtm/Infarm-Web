// src/app/checkout/success/page.tsx
// Halaman "Pesanan Berhasil" (order confirmed) untuk ecommerce.
// Membaca order asli dari mock database via ?order=INV-xxxx; fallback ke contoh bila dibuka langsung.
//
// TATA LETAK: satu kolom di mobile, DUA KOLOM di desktop (lg+) — kiri status pesanan + aksi,
// kanan rincian item + total. Di bawah lg keduanya menumpuk dengan urutan yang sama.
//
// WARNA: seluruh elemen hijau memakai SATU warna dasar `brand-primary` (header, lingkaran ikon,
// kartu estimasi, tombol utama). Sebelumnya tiga blok hijau memakai shade berbeda
// (`brand-header/90` + `brand-light/60` + `brand-primary`) sehingga terlihat seperti tiga sistem
// yang tak berhubungan. Jangan kembalikan opacity/shade khusus per blok di sini.

import Link from 'next/link'
import Image from 'next/image'
import { X, Leaf, Clock, MapPin, Star, Ban, ShoppingBag } from 'lucide-react'
import { getOrderByOrderId } from '@/lib/mock-db/orders'
import { generateCancelToken } from '@/lib/order-token'
import { formatRupiah } from '@/lib/format'
import type { Order } from '@/types/order'
import PayNowButton from './PayNowButton'

// Order contoh bila halaman dibuka tanpa ?order= (mis. preview langsung)
const FALLBACK_ORDER: Order = {
  orderId: 'INF-882910',
  customerName: 'Pelanggan Infarm',
  date: '2023-10-22T10:00:00.000Z',
  items: [
    { productId: 'PRD-101', name: 'Benih Premium', quantity: 1, price: 20000 },
    { productId: 'PRD-102', name: 'Pupuk Nutrisi Cair', quantity: 1, price: 25000 },
  ],
  totalAmount: 45000,
  paymentStatus: 'Lunas',
  status: 'Diproses',
}

// Format tanggal singkat: "22 Okt 2023"
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

// Rentang estimasi tiba: tanggal order +2 s/d +4 hari → "24 Okt – 26 Okt"
function estimasiTiba(iso: string): string {
  const base = new Date(iso)
  if (Number.isNaN(base.getTime())) return '2–4 hari kerja'
  const fmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })
  const from = new Date(base.getTime() + 2 * 86_400_000)
  const to = new Date(base.getTime() + 4 * 86_400_000)
  return `${fmt.format(from)} – ${fmt.format(to)}`
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string; order?: string; pay_error?: string }>
}) {
  // Utamakan ?invoice= (baru); ?order= tetap didukung untuk tautan lama
  const { invoice, order: orderParam, pay_error: payError } = await searchParams
  const key = invoice ?? orderParam

  // Ambil order asli dari Supabase berdasarkan nomor_invoice; fallback ke contoh bila tak ketemu
  let order: Order | null = null
  if (key) {
    order = await getOrderByOrderId(key.replace(/^#/, ''))
  }
  const data = order ?? FALLBACK_ORDER

  // === Status dibaca dari DB, BUKAN dari parameter URL ===
  //
  // Halaman ini juga menjadi `failure_redirect_url` Xendit, jadi ia bisa dibuka oleh pembeli yang
  // BELUM membayar maupun yang sudah. Parameter redirect tak pernah dipercaya: siapa pun bisa
  // mengetiknya, dan status yang sah hanya datang dari webhook. Yang menentukan tampilan di bawah
  // adalah `status_pembayaran`/`order_status` yang baru saja dibaca dari Supabase.
  const isPaid = data.paymentStatus === 'Lunas'
  const isCancelled = data.status === 'Dibatalkan'
  const awaitingPayment = !isPaid && !isCancelled
  // Tombol bayar hanya bermakna untuk pesanan sungguhan yang masih menunggu — bukan untuk
  // FALLBACK_ORDER (halaman dibuka tanpa parameter).
  const canPay = awaitingPayment && Boolean(order)

  const heading = isCancelled
    ? 'Pesanan Dibatalkan'
    : isPaid
      ? 'Yeay! Pesananmu Sedang Disiapkan'
      : 'Selesaikan Pembayaran'
  const headerTitle = isCancelled
    ? 'Pesanan Dibatalkan'
    : isPaid
      ? 'Pesanan Berhasil'
      : 'Menunggu Pembayaran'
  const subheading = isCancelled
    ? 'Pesanan ini sudah dibatalkan. Stok produk telah dilepas kembali.'
    : isPaid
      ? 'Terima kasih telah berbelanja!'
      : 'Pesananmu sudah tersimpan. Selesaikan pembayaran agar segera kami proses.'
  const invoiceLabel = data.orderId.startsWith('#') ? data.orderId : `#${data.orderId}`
  // Token keamanan untuk tautan pembatalan (guest tidak login → tautan dilindungi token)
  const cancelToken = generateCancelToken(data.orderId)

  return (
    <div className="min-h-screen bg-brand-surface">
      {/* === Header — MELEBAR PENUH, bukan ikut lebar konten ===
          Di desktop konten dibatasi max-w, tapi bilah hijaunya tetap membentang seperti header
          halaman lain (AppBar/CartHeader). Teks & ikon PUTIH: sebelumnya `text-zinc-900` di atas
          hijau solid — kontrasnya nyaris tak terbaca. */}
      <header className="flex h-14 items-center gap-3 rounded-b-[2rem] bg-brand-primary px-5 text-white shadow-sm md:px-8">
        <Link
          href="/"
          aria-label="Tutup"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/15"
        >
          <X className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-white">{headerTitle}</h1>
      </header>

      {/* pb-28 (mobile): ruang aman agar konten paling bawah tak tertutup tombol WhatsApp
          mengambang (fixed, kanan bawah, ±76px tinggi area). Halaman ini tak punya bilah aksi
          bawah sehingga --sticky-bar-h = 0 dan tombol WA duduk di posisi dasarnya.
          lg:pb-8 — di desktop ruang aman itu TIDAK diperlukan untuk kolom kiri: tombol berada di
          x ±405–970 sementara tombol WA di x ±1900, jadi keduanya tak pernah bertabrakan. Sisa
          32px hanya jarak bernapas, sehingga tombol benar-benar turun ke dasar layar. */}
      <main className="mx-auto w-full max-w-md px-5 pb-28 pt-6 md:max-w-xl lg:max-w-4xl lg:px-8 lg:pb-8">
        {/* TIGA blok anak dengan URUTAN BERBEDA per breakpoint — karena itu blok tombol berdiri
            sendiri, bukan bersarang di dalam blok status:
              - mobile (flex kolom, urutan DOM): status → rincian pesanan → tombol.
                Rincian barang yang dibeli harus menempel di bawah estimasi; menyelipkan tombol di
                antaranya memutus alur "apa yang terjadi → apa yang saya beli → apa yang bisa saya
                lakukan".
              - desktop (grid 2 kolom × 2 baris): status kiri-atas, rincian di kanan membentang dua
                baris, tombol kiri-bawah.
            Baris grid `[1fr_auto]`: baris 1 menyerap seluruh sisa ruang dan blok status
            di-`self-center` di dalamnya (ruang kosong terbagi rata atas-bawah, bukan menumpuk jadi
            satu lubang), baris 2 setinggi isinya sehingga tombol berhenti tepat di dasar.
            lg:min-h-[calc(100vh-7rem)] = tinggi viewport − header (3.5rem) − pt-6 (1.5rem) −
            lg:pb-8 (2rem). Angka 7rem HARUS ikut berubah bila salah satu dari ketiganya diubah,
            kalau tidak blok tombol berhenti sebelum / melewati dasar layar. */}
        <div className="flex flex-col gap-6 lg:grid lg:min-h-[calc(100vh-7rem)] lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-6">
          {/* ================= BLOK 1: status pesanan (desktop: kiri-atas) ================= */}
          <section className="lg:col-start-1 lg:row-start-1 lg:self-center">
            {/* === Ilustrasi sukses ===
                Proporsinya dikecilkan (dulu lingkaran 128px berisi lingkaran 80px): sebagai
                penanda status ia tak perlu mendominasi, cukup memimpin judul di bawahnya.
                Cincin memakai warna dasar yang sama dengan transparansi, bukan hijau kedua.
                Rata tengah di SEMUA lebar layar — termasuk desktop. */}
            <div className="flex justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary text-white shadow-md ring-8 ring-brand-primary/10">
                <Leaf className="h-7 w-7" />
              </span>
            </div>

            {/* === Pesan utama (rata tengah di semua lebar layar) === */}
            <div className="mt-4 text-center">
              <h2 className="text-2xl font-bold text-zinc-900">{heading}</h2>
              <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">
                {subheading}
              </p>
            </div>

            {/* === Kartu informasi, isinya mengikuti status pembayaran ===
                Estimasi tiba HANYA ditampilkan bila sudah lunas. Menampilkannya pada pesanan yang
                belum dibayar adalah janji yang belum tentu ditepati — kurir baru dipesan setelah
                pembayaran masuk. */}
            {isPaid ? (
              <div className="mt-6 rounded-2xl bg-brand-primary p-5 text-white">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <p className="text-sm font-semibold">Estimasi Tiba: {estimasiTiba(data.date)}</p>
                </div>
                <p className="mt-1 text-sm text-white/80">
                  Pesananmu akan segera dikirimkan oleh kurir kami.
                </p>
              </div>
            ) : isCancelled ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
                <p className="text-sm font-semibold text-rose-800">Pesanan ini tidak diproses</p>
                <p className="mt-1 text-sm text-rose-700">
                  Jika Anda tetap ingin memesan, silakan buat pesanan baru.
                </p>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-center gap-2 text-amber-900">
                  <Clock className="h-4 w-4" />
                  <p className="text-sm font-semibold">Menunggu Pembayaran</p>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-amber-800">
                  Pesanan diproses setelah pembayaran kami terima. Selesaikan dalam 24 jam —
                  setelah itu pesanan dibatalkan otomatis dan stok dilepas kembali.
                </p>
              </div>
            )}
          </section>

          {/* ================= BLOK 2: rincian item & total =================
              Di mobile blok ini datang PERSIS setelah estimasi (sebelum tombol). Di desktop pindah
              ke kolom kanan dan membentang dua baris supaya sejajar dengan tinggi kolom kiri. */}
          <section className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="w-full rounded-2xl bg-white p-5 shadow-sm md:shadow-md">
              {/* Baris atas: Order ID + tanggal/status */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Nomor Pesanan
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-zinc-900">{invoiceLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-400">{formatShortDate(data.date)}</p>
                  <p className="mt-0.5 text-sm font-semibold text-brand-primary">Berhasil</p>
                </div>
              </div>

              {/* Daftar item — item promo (produk gratis) dipisahkan secara visual & harga "Gratis" */}
              <div className="mt-4 space-y-3 border-t border-dashed border-zinc-200 pt-4">
                {data.items.map((item) => (
                  <div
                    key={`${item.productId}-${item.isPromoItem ? 'promo' : 'buy'}`}
                    className="flex items-center gap-3"
                  >
                    <div
                      className={`relative h-11 w-11 flex-none overflow-hidden rounded-lg border bg-zinc-50 ${
                        item.isPromoItem ? 'border-brand-light' : 'border-zinc-100'
                      }`}
                    >
                      <Image
                        src={item.imageUrl || '/images/product-placeholder.png'}
                        alt={item.name}
                        fill
                        unoptimized
                        sizes="44px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* line-clamp-2, bukan truncate: nama produk katalog ini panjang dan satu
                          baris terpotong di tengah kata. JANGAN tambahkan `block` — line-clamp
                          butuh `display: -webkit-box` dan `block` menimpanya. */}
                      <p
                        className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900"
                        title={item.name}
                      >
                        {item.isPromoItem ? `🎁 ${item.name}` : item.name}
                      </p>
                      {/* Nama varian terpilih (produk bervarian) */}
                      {item.variantName && (
                        <p className="truncate text-xs font-medium text-brand-primary">
                          Varian: {item.variantName}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400">
                        {item.isPromoItem ? 'Bonus Promo' : `${item.quantity}× item`}
                      </p>
                    </div>
                    {/* Harga: item promo tertulis "Gratis" (bukan Rp0 polos) */}
                    {item.isPromoItem && (
                      <span className="shrink-0 text-sm font-bold text-brand-primary">Gratis</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Total — angka terpenting di halaman ini, jadi ukurannya dinaikkan jauh di atas
                  label lain dan diberi warna harga (brand-primary, sesuai aturan palet). */}
              <div className="mt-4 flex items-end justify-between border-t border-dashed border-zinc-200 pt-4">
                <span className="pb-1 text-sm font-medium text-zinc-500">Total Terbayar</span>
                <span className="text-2xl font-bold leading-none text-brand-primary sm:text-3xl">
                  {formatRupiah(data.totalAmount)}
                </span>
              </div>
            </div>
          </section>

          {/* ================= BLOK 3: aksi — HIERARKI BERTINGKAT =================
              Sebelumnya keempat tombol tampil identik (outline putih di dalam kartu hijau) sehingga
              tak ada yang menonjol. Sekarang: melacak pesanan = aksi paling relevan setelah bayar
              → tombol utama solid; ulasan & belanja lagi = sekunder; membatalkan pesanan =
              destruktif, sengaja paling kecil supaya tak tertekan tanpa sengaja (rose mengikuti
              pengecualian aksi destruktif di CLAUDE.md).
              Mobile: blok TERAKHIR, setelah rincian pesanan. Desktop: kiri-bawah (baris 2 grid,
              yang tingginya pas isi) sehingga berhenti tepat di dasar layar. */}
          <div className="space-y-3 lg:col-start-1 lg:row-start-2">
            {/* Penerbitan tagihan gagal saat checkout (?pay_error=1). Pesanannya TETAP tersimpan —
                itu yang perlu ditegaskan supaya pembeli tak menyangka harus checkout ulang dan
                membuat pesanan kedua. */}
            {canPay && payError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800"
              >
                Pesanan Anda sudah tersimpan, tapi halaman pembayaran gagal dibuka. Tekan{' '}
                <strong>Bayar Sekarang</strong> untuk mencoba lagi — jangan checkout ulang.
              </div>
            )}

            {/* Tombol bayar hanya muncul untuk pesanan yang MASIH menunggu pembayaran */}
            {canPay && <PayNowButton invoice={data.orderId} />}

            <Link
              href="/track-order"
              className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3 font-heading text-sm font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
            >
              <MapPin className="h-4 w-4" />
              Lacak Pesanan
            </Link>

            {/* Halaman ulasan kini berbasis no_telepon (verified) — cukup arahkan ke /review;
                nomor telepon auto-fill dari cookie checkout untuk menampilkan produk yang bisa diulas. */}
            <Link
              href="/review"
              className="flex items-center justify-center gap-2 rounded-xl border border-brand-primary bg-white py-3 text-sm font-semibold text-brand-primary transition hover:bg-brand-surface active:scale-[0.99]"
            >
              <Star className="h-4 w-4" />
              Beri Ulasan Produk
            </Link>

            <Link
              href="/"
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
            >
              <ShoppingBag className="h-4 w-4" />
              Kembali Belanja
            </Link>

            {/* Pembatalan pesanan (Guest) — tautan dibawa dengan token keamanan */}
            <Link
              href={`/order-cancellation?id=${encodeURIComponent(data.orderId)}&token=${cancelToken}`}
              className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-rose-600 transition hover:text-rose-700 hover:underline"
            >
              <Ban className="h-3.5 w-3.5" />
              Batalkan Pesanan
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
