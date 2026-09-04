'use client'

// src/app/checkout/page.tsx
// Halaman Checkout. Di luar route group (store) karena punya header hijau sendiri (CheckoutHeader).
// Orchestrator: menyimpan semua state (modal, kurir, asuransi, pembayaran) & menghitung total reaktif.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShoppingBag, PackageX } from 'lucide-react'
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
import EmailConfirmModal from '@/components/checkout/EmailConfirmModal'
import CheckoutSkeleton from '@/components/checkout/CheckoutSkeleton'
import {
  readCheckoutDraft,
  writeCheckoutDraft,
  clearCheckoutDraft,
  draftAdaIsinya,
  emptyAddress,
} from '@/lib/checkout-draft'
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
import { setGuestEmail } from '@/lib/guest-email'
import type { CheckoutItem } from '@/lib/data/dummy-checkout'

// Produk untuk kebutuhan halaman ini: Product + berat (gram) dari OMS. Produk dummy tak punya
// berat → undefined, dan lib/shipping-weight memakai berat cadangan untuk item seperti itu.
type CheckoutProduct = Product & { berat?: number }

// Penanda "kode sudah berjalan di browser".
//
// Cookie hanya terbaca di klien, jadi render pertama SELALU melihat keranjang kosong. Tanpa
// penanda ini, halaman berkedip ke keadaan "keranjang kosong" sepersekian detik setiap kali
// checkout dibuka — jenis kedipan yang sama dengan yang baru saja kita hilangkan.
//
// Memakai useSyncExternalStore, bukan useState+useEffect: pola itu memanggil setState di dalam
// effect, yang ditolak aturan lint proyek ini.
const subscribeNothing = () => () => {}

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
  const [isEmailConfirmOpen, setIsEmailConfirmOpen] = useState(false) // popup konfirmasi alamat email
  const [isPaying, setIsPaying] = useState(false) // mencegah double submit saat memproses bayar

  // === Draf isian yang tersimpan dari kunjungan sebelumnya (localStorage) ===
  //
  // Dibaca SEKALI saat mount. Aman terhadap hidrasi walau menyentuh localStorage: selama `hydrated`
  // masih false halaman merender kerangka, jadi nilai ini belum memengaruhi keluaran apa pun saat
  // React mencocokkan HTML server dengan render klien pertama.
  //
  // `useMemo` dengan dependency kosong, BUKAN useEffect+setState: pola itu ditolak aturan lint
  // proyek ini, dan draf memang tak perlu jadi state — ia hanya benih nilai awal.
  const draftTersimpan = useMemo(() => readCheckoutDraft(), [])

  // === Alamat pengiriman: diangkat dari AddressForm agar nama/telepon/alamat & destination_id dipakai saat order ===
  // Kosong di awal, kecuali ada draf yang bisa dipulihkan.
  const [address, setAddress] = useState<AddressFormState>(
    () => draftTersimpan?.address ?? emptyAddress(),
  )

  // Ref ke AddressForm untuk menampilkan error & scroll saat submit ditolak
  const addressFormRef = useRef<AddressFormHandle>(null)
  // Pesan toast singkat (mis. saat tombol ditekan tapi alamat/kurir belum lengkap)
  const [toast, setToast] = useState('')

  // Apakah seluruh field alamat valid → menentukan status tombol bayar
  const isAddressValid = useMemo(() => validateAddress(address).valid, [address])

  // === Kurir terpilih (selected_courier) hasil cek ongkir ===
  //
  // Ikut dipulihkan dari draf supaya baris "Metode Pengiriman" & total langsung terisi setelah
  // refresh. Harganya BELUM tentu masih berlaku — ShippingOptions menarik tarif baru untuk tujuan
  // ini dan mengganti pilihan yang tak lagi ada di daftar (lihat rekonsiliasi di komponen itu).
  // Tanpa penggantian tersebut, tarif basi akan lolos ke `POST /api/orders/create` dan ditolak
  // `409 SHIPPING_MISMATCH` tepat saat pembeli menekan bayar — kegagalan paling mahal waktunya.
  const [selectedCourier, setSelectedCourier] = useState<WarehouseShippingOption | null>(
    () => draftTersimpan?.courier ?? null,
  )

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

  // Daftar id produk yang perlu di-resolve, sebagai satu string stabil.
  //
  // Dipakai sebagai dependency efek DAN sebagai penanda "jawaban ini untuk permintaan yang mana".
  // Di-dedup & diurutkan supaya urutan item di keranjang tak memicu tarikan ulang yang percuma.
  const productIdsKey = useMemo(
    () => [...new Set(checkoutCookieItems.map((ci) => ci.productId))].sort().join(','),
    [checkoutCookieItems],
  )

  // === Produk OMS diambil via API agar item dari cookie ikut ter-resolve (nama, foto, berat) ===
  //
  // Memakai `by-ids`, BUKAN `products/list`. `list` menarik SELURUH katalog tanpa cache
  // (`readProducts()` langsung) hanya untuk me-resolve satu-dua produk — makin besar katalog, makin
  // lama pembeli menatap kerangka. `by-ids` dibaca dari cache (30 detik, tag `products`) dan hanya
  // mengembalikan id yang diminta. Bentuk datanya identik, `berat` ikut terbawa sehingga hitung
  // ongkir tak berubah.
  const [omsProducts, setOmsProducts] = useState<CheckoutProduct[]>([])

  // Kunci permintaan yang SUDAH dijawab. Dibandingkan dengan `productIdsKey`, bukan boolean:
  // boolean tak bisa membedakan "sudah dijawab untuk daftar ini" dari "sudah dijawab untuk daftar
  // sebelumnya", dan isi keranjang bisa berubah selagi halaman terbuka.
  const [resolvedFor, setResolvedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!productIdsKey) return // tak ada yang perlu di-resolve

    let active = true
    const ctrl = new AbortController()

    fetch(`/api/products/by-ids?ids=${encodeURIComponent(productIdsKey)}`, { signal: ctrl.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return
        if (Array.isArray(data.products)) setOmsProducts(data.products as CheckoutProduct[])
        setResolvedFor(productIdsKey)
      })
      .catch(() => {
        // Gagal pun HARUS menandai selesai — kalau tidak, halaman terjebak menampilkan kerangka
        // selamanya dan pembeli tak pernah tahu ada yang salah. Item yang tak ter-resolve akan
        // jatuh ke keadaan "produk tak tersedia lagi", yang setidaknya bisa ditindaklanjuti.
        if (active) setResolvedFor(productIdsKey)
      })

    return () => {
      active = false
      ctrl.abort()
    }
  }, [productIdsKey])

  // Lookup produk gabungan (OMS + dummy). Produk OMS menimpa dummy bila id sama.
  const productById = useMemo(() => {
    const map = new Map<string, CheckoutProduct>()
    for (const product of dummyProducts) map.set(product.id, product)
    for (const product of omsProducts) map.set(product.id, product)
    return map
  }, [omsProducts])

  // Gabungkan item cookie dengan detail produk (nama, foto).
  //
  // Cookie kosong → array kosong, dan halaman menampilkan keadaan kosong (lihat `showEmptyState`).
  // DULU di sini ada fallback ke DUMMY_ORDER_ITEMS "agar halaman tetap terisi"; itu dibuang karena
  // mengisi halaman dengan produk & harga KARANGAN. Akibat nyatanya sudah dua kali muncul:
  // total berkedip ke Rp229.000 sebelum redirect ke Xendit, dan pembeli yang menekan tombol Back
  // dari halaman sukses melihat dua produk yang tak pernah ia pesan. Siapa pun yang mengetik
  // /checkout langsung di address bar juga melihatnya.
  const orderItems: CheckoutItem[] = useMemo(() => {
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

  // Kode sudah berjalan di browser (cookie hanya terbaca di klien).
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )

  // === Keadaan halaman ===
  //
  // DULU cuma ada satu penilaian: `hydrated && orderItems.length === 0` → tampilkan "Belum ada
  // produk untuk dibayar". Itu menyamakan dua hal yang sangat berbeda, dan salah pada kasus yang
  // paling sering terjadi:
  //
  //   Pembeli menekan "Beli Langsung" → cookie DITULIS lengkap sebelum pindah halaman → checkout
  //   membacanya utuh di render pertama. Tapi cookie hanya memuat { productId, quantity, price };
  //   nama & foto baru datang dari API. Selama tarikan itu berjalan, `productById` belum mengenal
  //   produk OMS → `flatMap` membuang SETIAP item → orderItems kosong → `hydrated` sudah true →
  //   dan pembeli yang baru saja memilih produk dibilang belum memilih apa pun.
  //
  // Racenya bukan di cookie (itu sinkron), melainkan di tarikan detail produk. Karena itu keadaan
  // halaman dipisah jadi empat, dan yang menentukan EMPTY adalah ISI COOKIE — bukan hasil
  // pemetaannya:
  //
  //   loading      — belum terhidrasi, atau cookie berisi tapi detail produk belum lengkap
  //   empty        — cookie memang kosong (buka /checkout langsung, atau keranjang kosong).
  //                  Diputuskan SEKETIKA, tanpa menunggu API: tak ada yang perlu di-resolve.
  //   unavailable  — cookie berisi, tarikan sudah selesai, tapi tak satu pun produk ketemu.
  //                  Nyata terjadi bila admin mengarsipkan produk setelah pembeli menaruhnya.
  //   ready        — detail produk tersedia
  const productsResolved = resolvedFor === productIdsKey
  const semuaItemTerpetakan = orderItems.length === checkoutCookieItems.length

  const viewState: 'loading' | 'empty' | 'unavailable' | 'ready' = !hydrated
    ? 'loading'
    : checkoutCookieItems.length === 0
      ? 'empty'
      : semuaItemTerpetakan
        ? 'ready' // semua item punya detail (mis. produk dummy, atau API sudah menjawab)
        : !productsResolved
          ? 'loading'
          : orderItems.length > 0
            ? 'ready' // sebagian hilang, tapi masih ada yang bisa dibayar
            : 'unavailable'

  // Subtotal dihitung dari item pesanan aktual (harga × kuantitas)
  const subtotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [orderItems],
  )

  // Id produk gratis promo (dari snapshot keranjang). Server tetap otoritatif saat create order;
  // ini hanya untuk TAMPILAN ringkasan & perhitungan berat kirim.
  //
  // Dibaca saat RENDER (setelah hidrasi), bukan lewat `useEffect` + `setState`. Pola lama melanggar
  // aturan lint proyek ini (`react-hooks/set-state-in-effect`) dan sudah membuat `npm run lint`
  // merah di berkas ini sebelum perubahan ini — cocok dibereskan sekarang karena penyebab & obatnya
  // sama persis dengan race yang sedang diperbaiki: keadaan turunan dari cookie tak perlu melewati
  // state sama sekali.
  //
  // `hydrated` jadi dependency-nya: cookie hanya terbaca di klien, jadi nilainya kosong di render
  // server lalu terisi sekali begitu berjalan di browser.
  const freeProductIds = useMemo(
    () => (hydrated ? (getCheckoutPromo()?.freeProductIds ?? []) : []),
    [hydrated],
  )

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

  // === Simpan draf isian (debounce 400ms) ===
  //
  // Debounce, bukan tulis per ketukan: mengetik alamat lengkap bisa 60+ karakter, dan
  // `JSON.stringify` + `setItem` di tiap ketukan adalah kerja sinkron yang menahan thread UI.
  // 400ms cukup singkat sehingga refresh yang tak disengaja hampir selalu jatuh setelah
  // penyimpanan terakhir, dan cukup panjang untuk melewati satu kata yang diketik cepat.
  //
  // Timer di-reset tiap perubahan (cleanup `clearTimeout`), jadi yang tersimpan selalu keadaan
  // TERAKHIR — bukan tumpukan penulisan tertunda.
  //
  // TIDAK menulis saat `isPaying`: pesanan sedang dibuat dan draf akan dihapus sebentar lagi;
  // penulisan yang menyusul setelah penghapusan justru menghidupkan kembali draf yang baru dibuang.
  useEffect(() => {
    if (!hydrated || isPaying) return
    if (!draftAdaIsinya(address, selectedCourier)) return

    const timer = setTimeout(() => writeCheckoutDraft(address, selectedCourier), 400)
    return () => clearTimeout(timer)
  }, [hydrated, isPaying, address, selectedCourier])

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

    // Validasi lolos → JANGAN langsung bayar. Tampilkan popup konfirmasi email dulu.
    // Proses bayar sebenarnya dijalankan proceedPayment() saat user tekan "Lanjutkan Checkout".
    setIsEmailConfirmOpen(true)
  }

  // Proses bayar sebenarnya — dipanggil dari popup konfirmasi ("Lanjutkan Checkout").
  async function proceedPayment() {
    if (isPaying || !selectedCourier) return
    setIsEmailConfirmOpen(false)
    setIsPaying(true)

    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Nilai sudah divalidasi (telepon = angka bersih 08xx, email sudah huruf kecil)
          customerName: address.recipientName.trim(),
          customerPhone: address.phone,
          // Disimpan ke orders.email. Inilah kunci yang dipakai pembeli untuk melacak pesanannya
          // di /track-order, jadi ia harus tersimpan persis seperti yang divalidasi di form —
          // jangan diubah bentuknya lagi di sini.
          customerEmail: address.email,
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

      // Pesanan SUDAH tersimpan → draf isian tak lagi punya alasan untuk ada.
      //
      // Dihapus DI SINI, bukan setelah tagihan terbit: pesanannya sudah nyata apa pun hasil
      // penerbitan tagihan, jadi membiarkan draf hidup berarti belanja berikutnya dimulai dengan
      // alamat pesanan ini sudah terisi — terlihat seperti sistem salah mengambil data.
      //
      // Berbeda dari `clearCart()` di bawah yang sengaja menunggu: mengosongkan keranjang lebih
      // awal membuat halaman ini berkedip ke keadaan kosong sebelum berpindah ke Xendit.
      clearCheckoutDraft()

      // Order berhasil → simpan identitas guest ke cookie untuk auto-recognize berikutnya, dan
      // naikkan estimasi pesanan aktif (badge angka header; di-refresh akurat saat buka
      // /pesanan-saya). Keranjang BELUM dikosongkan di sini — lihat catatan di bawah.
      //
      // DUA cookie, bukan satu, karena halamannya memakai identitas berbeda:
      //   infarm_phone → /cancel-order, /review, badge pesanan aktif
      //   infarm_email → /track-order
      setGuestPhone(address.phone)
      setGuestEmail(address.email)
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
      //
      // `replace`, BUKAN `push` — alasannya sama dengan window.location.replace di jalur berhasil
      // tepat di atas: keranjang sudah dikosongkan, jadi /checkout tak boleh tertinggal di riwayat
      // browser. Dengan `push`, satu kali tombol Back memulangkan pembeli ke halaman checkout tanpa
      // isi dan ia melihat keadaan kosong yang membingungkan padahal pesanannya sudah tersimpan.
      console.error('[checkout] gagal menerbitkan tagihan:', payData.error ?? payRes.status)
      router.replace(
        `/checkout/success?invoice=${encodeURIComponent(data.invoice)}&pay_error=1`,
      )
    } catch {
      setToast('Gagal memproses pesanan. Periksa koneksi lalu coba lagi.')
      setIsPaying(false)
    }
  }

  // === Cabang tampilan ===
  // Ditempatkan SETELAH seluruh hook supaya urutan hook tetap sama di tiap render.
  //
  // ⚠️ Ketiganya dilewati saat `isPaying`. Setelah pesanan tersimpan, `clearCart()` mengosongkan
  // cookie checkout dan halaman ini reaktif terhadapnya — tanpa pengecualian ini, keadaan halaman
  // berubah jadi `empty` tepat sebelum berpindah ke Xendit, dan pembeli sekilas melihat "Belum ada
  // produk untuk dibayar" persis setelah menekan bayar. Dengan dilewati, tirai "Mengalihkan ke
  // pembayaran…" di bawah tetap yang menutupi layar.

  // LOADING — detail produk belum lengkap. Kerangka, BUKAN keadaan kosong.
  if (viewState === 'loading' && !isPaying) {
    return (
      <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
        <CheckoutHeader />
        <CheckoutSkeleton />
      </div>
    )
  }

  // EMPTY & UNAVAILABLE — tak ada yang bisa dibayar. Jangan tampilkan form, ongkir, apalagi
  // tombol bayar. Dua keadaan, dua pesan: pembeli yang belum memilih apa pun butuh diarahkan ke
  // keranjang, sedangkan pembeli yang produknya baru ditarik admin butuh tahu ITU yang terjadi —
  // dibilang "belum memilih" setelah ia jelas-jelas menekan Beli Langsung hanya membuatnya
  // mengira sistemnya rusak.
  if ((viewState === 'empty' || viewState === 'unavailable') && !isPaying) {
    const tidakTersedia = viewState === 'unavailable'
    return (
      <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
        <CheckoutHeader />
        <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-10">
          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
            <span
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
                tidakTersedia ? 'bg-orange-50 text-orange-500' : 'bg-brand-surface text-brand-primary'
              }`}
            >
              {tidakTersedia ? (
                <PackageX className="h-6 w-6" />
              ) : (
                <ShoppingBag className="h-6 w-6" />
              )}
            </span>
            <h1 className="mt-3 text-base font-bold text-zinc-800">
              {tidakTersedia ? 'Produk sudah tidak tersedia' : 'Belum ada produk untuk dibayar'}
            </h1>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-zinc-500">
              {tidakTersedia
                ? 'Produk yang kamu pilih sudah ditarik dari katalog, jadi pesanannya tidak bisa dilanjutkan. Silakan pilih produk lain.'
                : 'Pilih produk di keranjang lebih dulu, lalu tekan Checkout. Kalau kamu baru saja menyelesaikan pesanan, pesanan itu sudah tersimpan dan bisa dilihat di Lacak Pesanan.'}
            </p>
            <div className="mt-5 space-y-2">
              <Link
                href={tidakTersedia ? '/products' : '/keranjang'}
                className="block rounded-xl bg-brand-primary py-3 font-heading text-sm font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
              >
                {tidakTersedia ? 'Lihat Produk Lain' : 'Ke Keranjang'}
              </Link>
              <Link
                href={tidakTersedia ? '/keranjang' : '/track-order'}
                className="block rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50"
              >
                {tidakTersedia ? 'Ke Keranjang' : 'Lacak Pesanan'}
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
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
          <AddressForm
            ref={addressFormRef}
            onChange={handleAddressChange}
            initialValue={draftTersimpan?.address}
          />
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

      {/* === Popup konfirmasi EMAIL (setelah validasi lolos, sebelum bayar) === */}
      {/* "Kembali" / klik luar / X → tutup + kembalikan fokus ke field email untuk dikoreksi.
          Dulu popup ini mengonfirmasi no_telepon — lihat alasan pindahnya di EmailConfirmModal. */}
      <EmailConfirmModal
        open={isEmailConfirmOpen}
        email={address.email}
        onBack={() => {
          setIsEmailConfirmOpen(false)
          addressFormRef.current?.focusEmail()
        }}
        onConfirm={proceedPayment}
      />

      {/* === Tirai "mengalihkan ke pembayaran" ===
          Menutup layar sejak tombol bayar ditekan sampai halaman berpindah ke Xendit.

          KENAPA PERLU: setelah order tersimpan, clearCart() menghapus cookie `infarm_checkout` dan
          halaman ini reaktif terhadapnya — jadi ia pasti render ulang tepat sebelum berpindah.
          Dulu render ulang itu jatuh ke fallback DUMMY_ORDER_ITEMS dan total berkedip ke angka
          karangan; fallback-nya kini sudah dibuang, tapi tirai ini tetap dipertahankan karena
          keadaan kosong yang menggantikannya juga tak boleh sempat terlihat sedetik pun sebelum
          pembeli diarahkan ke Xendit.

          Berlaku untuk semua penyebab, bukan hanya yang ini: apa pun yang membuat halaman render
          ulang selama proses bayar tak akan terlihat lagi. */}
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

