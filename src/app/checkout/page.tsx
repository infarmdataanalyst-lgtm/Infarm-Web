'use client'

// src/app/checkout/page.tsx
// Halaman Checkout. Di luar route group (store) karena punya header hijau sendiri (CheckoutHeader).
// Orchestrator: menyimpan semua state (modal, kurir, asuransi, pembayaran) & menghitung total reaktif.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/types/product'
import CheckoutHeader from '@/components/checkout/CheckoutHeader'
import CheckoutProductSummary from '@/components/checkout/CheckoutProductSummary'
import AddressForm, {
  type AddressFormState,
  type AddressFormHandle,
} from '@/components/checkout/AddressForm'
import OrderSummary from '@/components/checkout/OrderSummary'
import CheckoutBottomBar from '@/components/checkout/CheckoutBottomBar'
import ShippingOptions from '@/components/checkout/ShippingOptions'
import PaymentMethodsInfo from '@/components/checkout/PaymentMethodsInfo'
import PhoneConfirmModal from '@/components/checkout/PhoneConfirmModal'
import { validateAddress } from '@/lib/checkout-validation'
import { formatRupiah } from '@/lib/format'
import { shippingWeightKg, type WeighableItem } from '@/lib/shipping-weight'
import { type WarehouseShippingOption } from '@/lib/mengantar'
import { dummyProducts } from '@/lib/data/dummy-products'
import {
  subscribeCheckout,
  getCheckoutSnapshot,
  getServerCheckoutSnapshot,
  getCheckoutPromo,
  clearCart,
} from '@/lib/cart-client'
import { setGuestPhone, incrementActiveOrderCount } from '@/lib/guest-phone'
import { DUMMY_ORDER_ITEMS, type CheckoutItem } from '@/lib/data/dummy-checkout'

// Produk untuk kebutuhan halaman ini: Product + berat (gram) dari OMS. Produk dummy tak punya
// berat → undefined, dan lib/shipping-weight memakai berat cadangan untuk item seperti itu.
type CheckoutProduct = Product & { berat?: number }

// Pembungkus satu section checkout.
//
// Di MOBILE tak menambahkan apa pun secara visual — section tetap menempel tepi layar seperti
// sebelumnya. Di lg+ ia memberi bentuk kartu (border, sudut membulat, bayangan tipis).
//
// ⚠️ SENGAJA TANPA `overflow-hidden`, walau itu cara termudah membulatkan sudut isinya.
// Daftar saran alamat di AddressSearchCombobox memakai `absolute` dan akan TERPOTONG oleh ancestor
// ber-overflow-hidden — pencarian alamat jadi tak terpakai. Sebagai gantinya, sudut membulat
// diteruskan ke anak langsung (`section` / `button`) lewat arbitrary variant, sehingga latar putih
// anaknya tak menyembul di sudut. BottomSheet (root-nya `div`) tak ikut tersentuh.
function CheckoutCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`lg:rounded-2xl lg:border lg:border-zinc-200 lg:bg-white lg:shadow-sm lg:[&>button]:rounded-2xl lg:[&>section]:rounded-2xl ${className}`}
    >
      {children}
    </div>
  )
}

export default function CheckoutPage() {
  const router = useRouter()

  // === State tampilan modal ===
  const [isPhoneConfirmOpen, setIsPhoneConfirmOpen] = useState(false) // popup konfirmasi no. telepon
  const [isPaying, setIsPaying] = useState(false) // mencegah double submit saat memproses bayar

  // === Alamat pengiriman: diangkat dari AddressForm agar nama/telepon/alamat & destination_id dipakai saat order ===
  // Seluruh field kosong di awal (tidak ada prefill default).
  const [address, setAddress] = useState<AddressFormState>({
    recipientName: '',
    phone: '',
    destination_id: '',
    provinceName: '',
    cityName: '',
    districtName: '',
    subdistrictName: '',
    postalCode: '',
    street: '',
  })

  // Ref ke AddressForm untuk menampilkan error & scroll saat submit ditolak
  const addressFormRef = useRef<AddressFormHandle>(null)
  // Pesan toast singkat (mis. saat tombol ditekan tapi alamat/kurir belum lengkap)
  const [toast, setToast] = useState('')

  // Apakah seluruh field alamat valid → menentukan status tombol bayar
  const isAddressValid = useMemo(() => validateAddress(address).valid, [address])

  // === Kurir terpilih (selected_courier) hasil cek ongkir ===
  const [selectedCourier, setSelectedCourier] = useState<WarehouseShippingOption | null>(null)

  // Saat alamat berubah/di-reset (destination_id berganti), reset pilihan kurir → cek ongkir ulang.
  function handleAddressChange(next: AddressFormState) {
    if (next.destination_id !== address.destination_id) setSelectedCourier(null)
    setAddress(next)
  }

  // === Item yang dibeli: dari pilihan keranjang (cookie checkout), reaktif & aman SSR ===
  const checkoutCookieItems = useSyncExternalStore(
    subscribeCheckout,
    getCheckoutSnapshot,
    getServerCheckoutSnapshot,
  )

  // === Produk OMS (mock DB) diambil via API agar item dari OMS ikut ter-resolve, bukan hanya dummy ===
  // TODO: ganti dengan query Supabase setelah OMS selesai
  const [omsProducts, setOmsProducts] = useState<CheckoutProduct[]>([])
  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.products)) setOmsProducts(data.products as CheckoutProduct[])
      })
      .catch(() => {
        // Mode prototipe: bila gagal, fallback ke produk dummy saja
      })
    return () => {
      active = false
    }
  }, [])

  // Lookup produk gabungan (OMS + dummy). Produk OMS menimpa dummy bila id sama.
  const productById = useMemo(() => {
    const map = new Map<string, CheckoutProduct>()
    for (const product of dummyProducts) map.set(product.id, product)
    for (const product of omsProducts) map.set(product.id, product)
    return map
  }, [omsProducts])

  // Gabungkan item cookie dengan detail produk (nama, foto). Bila cookie kosong (mis. user
  // membuka /checkout langsung), pakai data dummy agar halaman tetap terisi.
  const orderItems: CheckoutItem[] = useMemo(() => {
    if (checkoutCookieItems.length === 0) return DUMMY_ORDER_ITEMS
    return checkoutCookieItems.flatMap((ci) => {
      const product = productById.get(ci.productId)
      if (!product) return []
      return [
        {
          id: ci.productId,
          name: product.name,
          quantity: ci.quantity,
          price: ci.price,
          imageUrl: product.imageUrl,
          variantId: ci.variantId,
          variantName: ci.variantName,
        },
      ]
    })
  }, [checkoutCookieItems, productById])

  // Subtotal dihitung dari item pesanan aktual (harga × kuantitas)
  const subtotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [orderItems],
  )

  // Id produk gratis promo (dari snapshot keranjang). Server tetap otoritatif saat create order;
  // ini hanya untuk TAMPILAN ringkasan & perhitungan berat kirim.
  const [freeProductIds, setFreeProductIds] = useState<string[]>([])
  useEffect(() => {
    const snap = getCheckoutPromo()
    setFreeProductIds(snap?.freeProductIds ?? [])
  }, [])

  // Item hadiah promo untuk DITAMPILKAN di ringkasan (harga 0, isPromoItem). Detail dari produk resolved.
  // TIDAK dikirim ke API create (server evaluasi & inject sendiri) → cegah duplikasi/manipulasi.
  const freeCheckoutItems: CheckoutItem[] = useMemo(() => {
    return freeProductIds.flatMap((id) => {
      const product = productById.get(id)
      if (!product) return []
      return [
        {
          id,
          name: product.name,
          quantity: 1,
          price: 0,
          imageUrl: product.imageUrl,
          isPromoItem: true,
        },
      ]
    })
  }, [freeProductIds, productById])

  // Daftar untuk ditampilkan di ringkasan = item beli + item hadiah promo.
  const summaryItems = useMemo(
    () => [...orderItems, ...freeCheckoutItems],
    [orderItems, freeCheckoutItems],
  )

  // Total berat kirim (kg) = SUM(berat produk × quantity), dikonversi dari gram di satu tempat
  // (lib/shipping-weight.ts). Dihitung ulang otomatis tiap isi keranjang berubah karena
  // orderItems bersumber dari cookie lewat useSyncExternalStore — dan ShippingOptions memakai
  // nilai ini sebagai dependency efek fetch-nya, jadi ongkir ikut di-refresh tanpa aksi tambahan.
  //
  // Produk hadiah promo IKUT ditimbang: barangnya tetap dikirim fisik, jadi mengabaikannya membuat
  // ongkir yang dikutip lebih murah daripada tarif kurir sebenarnya.
  //
  // Selama daftar produk OMS masih dalam perjalanan (fetch by-ids), berat item belum diketahui →
  // memakai berat cadangan. Nilainya dihitung ulang begitu produk tiba; buyer tak bisa menekan
  // bayar sebelum memilih kurir, jadi angka sementara ini tak pernah menjadi ongkir final.
  const shippingWeight = useMemo(() => {
    const weighable: WeighableItem[] = [...orderItems, ...freeCheckoutItems].map((item) => ({
      quantity: item.quantity,
      berat: productById.get(item.id)?.berat,
    }))
    return shippingWeightKg(weighable)
  }, [orderItems, freeCheckoutItems, productById])

  // Kebutuhan stok yang dikirim ke perbandingan ongkir: hanya produk yang dibeli (produk hadiah
  // promo TIDAK diikutkan — ketersediaannya dievaluasi server saat membuat order, dan menyertakannya
  // di sini bisa mengecualikan gudang yang sebenarnya sanggup mengirim pesanan utama).
  const shippingItems = useMemo(
    () =>
      orderItems.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        variantId: item.variantId ?? undefined,
      })),
    [orderItems],
  )

  // === Minimum total belanja (pengaturan toko) ===
  // Dibandingkan dengan SUBTOTAL BARANG (bukan subtotal+ongkir) agar pesan 'kurang Rp X lagi'
  // sama persis dengan yang tampil di keranjang, dan tetap konsisten dengan validasi server.
  const [minOrderAmount, setMinOrderAmount] = useState(0)
  useEffect(() => {
    let active = true
    fetch('/api/settings/min-order')
      .then((res) => res.json())
      .then((data: { minOrderAmount?: number }) => {
        if (active && typeof data.minOrderAmount === 'number') setMinOrderAmount(data.minOrderAmount)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // === Kalkulasi biaya: ongkir dari kurir terpilih (null bila belum pilih) ===
  const shipping = selectedCourier ? selectedCourier.price : null
  const total = subtotal + (selectedCourier?.price ?? 0)

  // Tombol bayar aktif hanya bila alamat valid DAN kurir sudah dipilih
  // Kekurangan agar mencapai minimum belanja (0 = sudah terpenuhi)
  const minOrderShortfall = Math.max(0, minOrderAmount - subtotal)
  const canPay = isAddressValid && selectedCourier !== null && minOrderShortfall === 0

  // Sembunyikan toast otomatis setelah beberapa detik
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // Proses bayar: simpan order (orders + order_items + kurangi stok, atomik via API) lalu
  // kosongkan keranjang & arahkan ke halaman sukses dengan ?invoice=.
  // Nomor invoice digenerate di server. Pembayaran masih PENDING (Xendit menyusul).
  async function handlePay() {
    if (isPaying) return

    // Lapisan kedua selain styling tombol: validasi alamat sebelum request apapun dikirim.
    // Bila belum valid, tampilkan error di tiap field + scroll ke yang pertama + toast.
    const valid = addressFormRef.current?.revealErrors() ?? validateAddress(address).valid
    if (!valid) {
      setToast('Lengkapi alamat pengiriman terlebih dahulu')
      return
    }

    // Kurir wajib dipilih sebelum bayar (lapisan kedua selain styling tombol)
    if (!selectedCourier) {
      setToast('Pilih kurir pengiriman terlebih dahulu')
      return
    }

    // Minimum belanja belum tercapai → hentikan sebelum request apa pun dikirim.
    // Server tetap memvalidasi ulang di /api/orders/create (jangan hanya andalkan guard ini).
    if (minOrderShortfall > 0) {
      setToast(`Minimal belanja ${formatRupiah(minOrderAmount)} untuk melanjutkan pembayaran`)
      return
    }

    // Validasi lolos → JANGAN langsung bayar. Tampilkan popup konfirmasi nomor telepon dulu.
    // Proses bayar sebenarnya dijalankan proceedPayment() saat user tekan "Lanjutkan Checkout".
    setIsPhoneConfirmOpen(true)
  }

  // Proses bayar sebenarnya — dipanggil dari popup konfirmasi ("Lanjutkan Checkout").
  async function proceedPayment() {
    if (isPaying || !selectedCourier) return
    setIsPhoneConfirmOpen(false)
    setIsPaying(true)

    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Nilai sudah divalidasi (telepon = angka bersih 08xx)
          customerName: address.recipientName.trim(),
          customerPhone: address.phone,
          items: orderItems.map((item) => ({
            productId: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price, // diabaikan server — harga otoritatif diambil dari DB/varian (K-3)
            variantId: item.variantId, // server pakai untuk harga & stok varian (Tahap 4)
          })),
          // Server menghitung ulang total dari harga DB + ongkir + diskon (totalAmount client diabaikan)
          totalAmount: total, // dikirim untuk kompatibilitas; server tetap hitung ulang
          shippingCost: selectedCourier.price,
          // service = JENIS LAYANAN, bukan estimasi tiba. Dulu diisi estimatedDate sehingga
          // kolom jenis_layanan di OMS berisi "2-4 hari" — menyesatkan. Nilai final ditulis ulang
          // oleh booking kurir dengan SERVICE_CODE dari Mengantar (mis. 'REG'); ini hanya nilai
          // awal sebelum pembayaran sukses.
          logistics: { courier: selectedCourier.name, service: 'Reguler' },
          // Gudang asal tarif yang dipilih buyer + berat yang dipakai saat cek ongkir.
          // Server memverifikasi ulang gudang ini (aktif & stok cukup) dan, bila gagal, jatuh ke
          // opsi termurah berikutnya dari perbandingan ongkir yang masih tersimpan di server.
          warehouseId: selectedCourier.warehouseId,
          weight: shippingWeight,
          // Alamat terstruktur dari form + hasil search Mengantar
          address: {
            shippingAddress: address.street,
            provinsi: address.provinceName,
            kota: address.cityName,
            kecamatan: address.districtName,
            kelurahan: address.subdistrictName,
            kodepos: address.postalCode,
            destinationId: address.destination_id,
          },
        }),
      })

      const data = (await res.json().catch(() => ({}))) as { invoice?: string; error?: string }
      if (!res.ok || !data.invoice) {
        // Mis. stok tidak cukup (409) → tampilkan pesan dari server
        setToast(data.error ?? 'Gagal memproses pesanan. Silakan coba lagi.')
        setIsPaying(false)
        return
      }

      // Order berhasil → simpan no_telepon ke cookie (auto-recognize di /track-order & /cancel-order)
      // dan naikkan estimasi pesanan aktif (badge angka header; di-refresh akurat saat buka
      // /pesanan-saya). Keranjang BELUM dikosongkan di sini — lihat catatan di bawah.
      setGuestPhone(address.phone)
      incrementActiveOrderCount()

      // Terbitkan tagihan Xendit lalu bawa pembeli ke halaman pembayarannya.
      //
      // Dilakukan SETELAH order tersimpan — bukan sebelum — karena tagihan mengacu pada
      // `nomor_invoice` yang baru dibuat server. Urutan ini juga berarti pesanannya TIDAK HILANG
      // bila penerbitan tagihan gagal: ia tetap ada berstatus Menunggu Pembayaran, dan pembeli
      // diarahkan ke halaman sukses yang menyediakan tombol bayar ulang.
      const payRes = await fetch('/api/payments/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: data.invoice }),
      })
      const payData = (await payRes.json().catch(() => ({}))) as {
        invoiceUrl?: string
        error?: string
      }

      // Keranjang dikosongkan SETELAH penerbitan tagihan selesai, bukan sebelumnya.
      //
      // Dilakukan di kedua cabang (berhasil & gagal) karena PESANANNYA sudah tersimpan apa pun
      // hasil penerbitan tagihan — membiarkan keranjang terisi berarti pembeli bisa memesan barang
      // yang sama dua kali tanpa sadar. Yang dihindari hanyalah mengosongkannya sebelum kita tahu
      // hasilnya.
      clearCart()

      if (payRes.ok && payData.invoiceUrl) {
        // FULL redirect (bukan router.push): tujuannya domain Xendit, di luar aplikasi ini.
        // `replace` supaya tombol "kembali" browser tak memantulkan pembeli ke halaman checkout
        // yang keranjangnya sudah dikosongkan.
        window.location.replace(payData.invoiceUrl)
        return
      }

      // Gagal menerbitkan tagihan → JANGAN biarkan pembeli menyangka pesanannya batal.
      // Ke halaman sukses (yang menampilkan status sungguhan dari DB + tombol bayar ulang),
      // sambil membawa alasannya agar bisa ditampilkan di sana.
      console.error('[checkout] gagal menerbitkan tagihan:', payData.error ?? payRes.status)
      router.push(
        `/checkout/success?invoice=${encodeURIComponent(data.invoice)}&pay_error=1`,
      )
    } catch {
      setToast('Gagal memproses pesanan. Periksa koneksi lalu coba lagi.')
      setIsPaying(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
      {/* Header sticky */}
      <CheckoutHeader />

      {/* Konten.
          MOBILE (< lg): satu kolom penuh, section menempel tepi layar — TIDAK BERUBAH.
            pb-32 memberi ruang untuk bilah bayar yang melayang di dasar layar.
          DESKTOP (lg+): dua kolom. Kiri = alamat pengiriman saja (porsi lebih besar, karena
            fieldnya paling banyak), kanan = produk → pengiriman → pembayaran → total.

          Penempatan kolom memakai `col-start` per item, BUKAN dua div pembungkus. Alasannya:
          urutan DOM harus tetap urutan mobile (produk → alamat → kirim → bayar → ringkasan),
          sementara di desktop alamat pindah ke kolom kiri. Membungkus tiap kolom akan memaksa
          urutan DOM mengikuti desktop dan merusak urutan mobile. */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-2 pb-32 lg:grid lg:grid-cols-[3fr_2fr] lg:grid-rows-[repeat(5,auto)] lg:items-start lg:gap-x-6 lg:gap-y-4 lg:space-y-0 lg:px-8 lg:pb-12 lg:pt-6">
        {/* 1 — Ringkasan produk yang dibeli (dari pilihan keranjang) — KANAN di desktop */}
        <CheckoutCard className="lg:col-start-2">
          <CheckoutProductSummary items={summaryItems} />
        </CheckoutCard>

        {/* 2 — Form alamat pengiriman — KIRI di desktop, satu-satunya isi kolom itu.
               `row-span-5` + `self-start` = resep sticky di dalam grid: kolomnya membentang
               setinggi seluruh baris (supaya ada ruang untuk menempel), tapi kartunya sendiri
               setinggi isinya. Tanpa row-span, area tempelnya cuma setinggi baris pertama dan
               sticky-nya tak pernah terlihat bekerja. */}
        <CheckoutCard className="lg:sticky lg:top-20 lg:col-start-1 lg:row-span-5 lg:row-start-1 lg:self-start">
          <AddressForm ref={addressFormRef} onChange={handleAddressChange} />
        </CheckoutCard>

        {/* 3 — Pilihan kurir & ongkir (bottom sheet). Isi keranjang dikirim agar server bisa
               membandingkan ongkir dari tiap gudang yang stoknya cukup.
               WAJIB dibungkus: komponennya me-return fragment (tombol + bottom sheet), jadi tanpa
               pembungkus ia menghasilkan DUA grid item dan sheet-nya ikut memakan satu baris. */}
        <CheckoutCard className="lg:col-start-2">
          <ShippingOptions
            destinationId={address.destination_id}
            weight={shippingWeight}
            items={shippingItems}
            selected={selectedCourier}
            onSelect={setSelectedCourier}
          />
        </CheckoutCard>

        {/* 4 — Metode pembayaran: INFORMASI saja. Pemilihannya terjadi di halaman Xendit. */}
        <CheckoutCard className="lg:col-start-2">
          <PaymentMethodsInfo />
        </CheckoutCard>

        {/* 5 — Ringkasan pesanan (rincian harga) */}
        <CheckoutCard className="lg:col-start-2">
          <OrderSummary subtotal={subtotal} shipping={shipping} total={total} />
        </CheckoutCard>

        {/* 6 — Total + tombol bayar sebagai kartu penutup kolom kanan. Hanya tampak di lg+;
               di mobile perannya dipegang bilah melayang di bawah (varian 'sticky'). */}
        <div className="lg:col-start-2">
          <CheckoutBottomBar
            variant="panel"
            total={total}
            onPay={handlePay}
            isPaying={isPaying}
            canPay={canPay}
            minOrderAmount={minOrderAmount}
            minOrderShortfall={minOrderShortfall}
          />
        </div>
      </main>

      {/* Toast singkat (mis. alamat belum lengkap saat menekan Bayar) */}
      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4" role="status">
          <p className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}

      {/* Bilah bayar bawah (sticky) */}
      <CheckoutBottomBar
        total={total}
        onPay={handlePay}
        isPaying={isPaying}
        canPay={canPay}
        minOrderAmount={minOrderAmount}
        minOrderShortfall={minOrderShortfall}
      />

      {/* === Popup konfirmasi nomor telepon (setelah validasi lolos, sebelum bayar) === */}
      {/* "Kembali" / klik luar / X → tutup + kembalikan fokus ke field telepon untuk dikoreksi */}
      <PhoneConfirmModal
        open={isPhoneConfirmOpen}
        phone={address.phone}
        onBack={() => {
          setIsPhoneConfirmOpen(false)
          addressFormRef.current?.focusPhone()
        }}
        onConfirm={proceedPayment}
      />

      {/* === Tirai "mengalihkan ke pembayaran" ===
          Menutup layar sejak tombol bayar ditekan sampai halaman berpindah ke Xendit.

          KENAPA PERLU: setelah order tersimpan, clearCart() menghapus cookie `infarm_checkout` dan
          halaman ini reaktif terhadapnya — render ulangnya jatuh ke DUMMY_ORDER_ITEMS (fallback
          untuk orang yang membuka /checkout langsung), sehingga total sempat berkedip ke angka
          dummy Rp225.000 + ongkir sepersekian detik sebelum redirect. Nominal yang DITAGIH tak
          pernah terpengaruh — server menghitung ulang dari harga DB — tapi angka yang berubah tepat
          sebelum membayar terbaca seperti tagihan yang diam-diam diganti.

          Tirai ini menutup gejalanya di semua kasus, bukan hanya yang ini: apa pun yang membuat
          halaman render ulang selama proses bayar tak akan terlihat lagi. */}
      {isPaying && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-brand-surface/95 backdrop-blur-sm"
        >
          <span
            className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary/25 border-t-brand-primary"
            aria-hidden
          />
          <p className="text-sm font-semibold text-brand-primary">Mengalihkan ke pembayaran…</p>
          <p className="px-8 text-center text-xs text-gray-500">
            Jangan tutup atau muat ulang halaman ini.
          </p>
        </div>
      )}
    </div>
  )
}

