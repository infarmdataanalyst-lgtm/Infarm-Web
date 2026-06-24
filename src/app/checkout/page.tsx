'use client'

// src/app/checkout/page.tsx
// Halaman Checkout. Di luar route group (store) karena punya header hijau sendiri (CheckoutHeader).
// Orchestrator: menyimpan semua state (modal, kurir, asuransi, pembayaran) & menghitung total reaktif.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/types/product'
import CheckoutHeader from '@/components/checkout/CheckoutHeader'
import CheckoutProductSummary from '@/components/checkout/CheckoutProductSummary'
import AddressForm, {
  type AddressFormState,
  type AddressFormHandle,
} from '@/components/checkout/AddressForm'
import OptionRow from '@/components/checkout/OptionRow'
import OrderSummary from '@/components/checkout/OrderSummary'
import CheckoutBottomBar from '@/components/checkout/CheckoutBottomBar'
import DeliveryModal from '@/components/checkout/DeliveryModal'
import PaymentModal from '@/components/checkout/PaymentModal'
import { formatRupiah } from '@/lib/format'
import { validateAddress } from '@/lib/checkout-validation'
import { dummyProducts } from '@/lib/data/dummy-products'
import {
  subscribeCheckout,
  getCheckoutSnapshot,
  getServerCheckoutSnapshot,
} from '@/lib/cart-client'
import {
  DUMMY_ORDER_ITEMS,
  DELIVERY_OPTIONS,
  PAYMENT_METHODS,
  INSURANCE_FEE,
  ORDER_DISCOUNT,
  type CheckoutItem,
} from '@/lib/data/dummy-checkout'

export default function CheckoutPage() {
  const router = useRouter()

  // === State tampilan modal ===
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isPaying, setIsPaying] = useState(false) // mencegah double submit saat memproses bayar

  // === Alamat pengiriman: diangkat dari AddressForm agar nama/telepon/email/alamat & destination_id dipakai saat order ===
  // Seluruh field kosong di awal (tidak ada prefill default).
  const [address, setAddress] = useState<AddressFormState>({
    recipientName: '',
    phone: '',
    email: '',
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
  // Pesan toast singkat (mis. saat tombol ditekan tapi alamat belum lengkap)
  const [toast, setToast] = useState('')

  // Apakah seluruh field alamat valid → menentukan status tombol bayar
  const isAddressValid = useMemo(() => validateAddress(address).valid, [address])

  // === State pilihan user ===
  const [selectedCourierId, setSelectedCourierId] = useState('jne') // default: rekomendasi
  const [insuranceEnabled, setInsuranceEnabled] = useState(true) // asuransi aktif default
  const [selectedPaymentId, setSelectedPaymentId] = useState('mandiri')

  // === Item yang dibeli: dari pilihan keranjang (cookie checkout), reaktif & aman SSR ===
  const checkoutCookieItems = useSyncExternalStore(
    subscribeCheckout,
    getCheckoutSnapshot,
    getServerCheckoutSnapshot,
  )

  // === Produk OMS (mock DB) diambil via API agar item dari OMS ikut ter-resolve, bukan hanya dummy ===
  // TODO: ganti dengan query Supabase setelah OMS selesai
  const [omsProducts, setOmsProducts] = useState<Product[]>([])
  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.products)) setOmsProducts(data.products as Product[])
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
    const map = new Map<string, Product>()
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
        },
      ]
    })
  }, [checkoutCookieItems, productById])

  // Subtotal dihitung dari item pesanan aktual (harga × kuantitas)
  const subtotal = useMemo(
    () => orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [orderItems],
  )

  // === Turunan pilihan ===
  const selectedCourier =
    DELIVERY_OPTIONS.find((o) => o.id === selectedCourierId) ?? DELIVERY_OPTIONS[0]
  const selectedPayment =
    PAYMENT_METHODS.find((m) => m.id === selectedPaymentId) ?? PAYMENT_METHODS[0]

  // === Kalkulasi biaya (reaktif terhadap kurir & asuransi) ===
  const shipping = selectedCourier.price + (insuranceEnabled ? INSURANCE_FEE : 0)
  const total = subtotal + shipping - ORDER_DISCOUNT

  // Sembunyikan toast otomatis setelah beberapa detik
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // Proses bayar (mode prototipe): simpan order ke mock DB lalu arahkan ke halaman sukses.
  // TODO: ganti simulasi ini dengan buat invoice via lib/xendit & redirect ke halaman Xendit.
  async function handlePay() {
    if (isPaying) return

    // Lapisan kedua selain styling tombol: validasi alamat sebelum request apapun dikirim.
    // Bila belum valid, tampilkan error di tiap field + scroll ke yang pertama + toast.
    const valid = addressFormRef.current?.revealErrors() ?? validateAddress(address).valid
    if (!valid) {
      setToast('Lengkapi alamat pengiriman terlebih dahulu')
      return
    }

    setIsPaying(true)

    // ID invoice unik sederhana untuk prototipe
    const orderId = `INV-${Date.now().toString().slice(-8)}`

    // Pecah string kurir ('JNE Reguler') → courier + service untuk tipe Order
    const [courier, ...serviceParts] = selectedCourier.courier.split(' ')

    try {
      await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          // Nilai sudah divalidasi sebelum sampai sini (telepon = angka bersih, email = lowercase)
          customerName: address.recipientName.trim(),
          customerPhone: address.phone,
          customerEmail: address.email,
          date: new Date().toISOString(),
          items: orderItems.map((item) => ({
            productId: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
          totalAmount: total,
          paymentStatus: 'Lunas',
          logistics: { courier, service: serviceParts.join(' ') || 'Reguler' },
        }),
      })
    } catch {
      // Mode prototipe: walau simpan gagal, tetap lanjut ke halaman sukses.
    }

    router.push(`/checkout/success?order=${orderId}`)
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
      {/* Header sticky */}
      <CheckoutHeader />

      {/* Konten — pb-24 agar tak tertutup bilah bayar bawah */}
      <main className="flex-1 space-y-2 pb-24">
        {/* 2 — Ringkasan produk yang dibeli (dari pilihan keranjang) */}
        <CheckoutProductSummary items={orderItems} />

        {/* 3 — Form input alamat pengiriman */}
        <AddressForm ref={addressFormRef} onChange={setAddress} />

        {/* 4 — Pilihan pengiriman (klik → buka modal) */}
        <OptionRow
          icon={<TruckIcon />}
          title="Metode Pengiriman"
          value={`${selectedCourier.courier} · ${formatRupiah(selectedCourier.price)}`}
          onClick={() => setIsDeliveryModalOpen(true)}
        />

        {/* 4 — Pilihan pembayaran (klik → buka modal) */}
        <OptionRow
          icon={<WalletIcon />}
          title="Metode Pembayaran"
          value={selectedPayment.name}
          onClick={() => setIsPaymentModalOpen(true)}
        />

        {/* 5 — Ringkasan pesanan (rincian harga) tepat sebelum tombol aksi */}
        <OrderSummary
          subtotal={subtotal}
          shipping={shipping}
          discount={ORDER_DISCOUNT}
          total={total}
        />
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
      <CheckoutBottomBar total={total} onPay={handlePay} isPaying={isPaying} canPay={isAddressValid} />

      {/* === Modal Pengiriman === */}
      <DeliveryModal
        open={isDeliveryModalOpen}
        onClose={() => setIsDeliveryModalOpen(false)}
        options={DELIVERY_OPTIONS}
        selectedId={selectedCourierId}
        onSelect={setSelectedCourierId}
        insuranceEnabled={insuranceEnabled}
        onToggleInsurance={setInsuranceEnabled}
      />

      {/* === Modal Pembayaran === */}
      <PaymentModal
        open={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        methods={PAYMENT_METHODS}
        selectedId={selectedPaymentId}
        onSelect={setSelectedPaymentId}
      />
    </div>
  )
}

// === Ikon inline ===

function TruckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <path d="M16 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="18.5" r="2" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
      <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  )
}
