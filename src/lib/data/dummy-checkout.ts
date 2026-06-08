// src/lib/data/dummy-checkout.ts
// Dummy data terstruktur untuk halaman Checkout: alamat, opsi pengiriman, metode pembayaran,
// dan ringkasan pesanan. Sementara — diganti data real setelah OMS & integrasi Xendit/Mengantar.
// TODO: ganti dengan data keranjang + API ongkir Mengantar + metode Xendit setelah OMS selesai.

// === Alamat Pengiriman ===

export type ShippingAddress = {
  label: 'HOME' | 'KANTOR'
  recipientName: string
  phone: string
  fullAddress: string
}

export const dummyAddress: ShippingAddress = {
  label: 'HOME',
  recipientName: 'Budi Santoso',
  phone: '0812-3456-7890',
  fullAddress:
    'Jl. Melati No. 12, RT 03/RW 05, Kel. Sukamaju, Kec. Cilodong, Kota Depok, Jawa Barat 16415',
}

// === Opsi Pengiriman (Kurir) ===

export type DeliveryOption = {
  id: string
  courier: string // mis. 'JNE Reguler'
  etaLabel: string // mis. '1-2 hari'
  price: number
  recommended?: boolean // tampil di seksi "Direkomendasikan untukmu!"
  badge?: string // mis. 'Termurah'
  note?: string // catatan khusus, mis. lokasi belum ditentukan
  disabled?: boolean // tidak bisa dipilih (mis. lokasi belum ditentukan)
}

// Biaya asuransi pengiriman (opsional, bisa diaktifkan/dimatikan di modal)
export const INSURANCE_FEE = 2500

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  {
    id: 'jne',
    courier: 'JNE Reguler',
    etaLabel: '1-2 hari',
    price: 20000,
    recommended: true,
    badge: 'Termurah',
  },
  {
    id: 'sicepat',
    courier: 'SiCepat Regular',
    etaLabel: '2-3 hari',
    price: 10000,
  },
  {
    id: 'lionparcel',
    courier: 'Lion Parcel — Reg Pack',
    etaLabel: '2-3 hari',
    price: 19800,
  },
  {
    id: 'gosend',
    courier: 'GoSend Instant',
    etaLabel: 'Titip Lokasi Belum Ditentukan',
    price: 0,
    note: 'Lokasi penjemputan belum ditentukan',
    disabled: true,
  },
]

// === Metode Pembayaran ===

export type PaymentMethod = {
  id: string
  name: string
  group: 'va' | 'other' // 'va' = Virtual Account, 'other' = Metode Lainnya
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  // Virtual Account
  { id: 'mandiri', name: 'Mandiri', group: 'va' },
  { id: 'bri', name: 'BRI', group: 'va' },
  { id: 'bni', name: 'BNI', group: 'va' },
  { id: 'permata', name: 'Permata', group: 'va' },
  { id: 'danamon', name: 'Danamon', group: 'va' },
  { id: 'bsi', name: 'BSI', group: 'va' },
  { id: 'cimb', name: 'CIMB Niaga', group: 'va' },
  // Metode Lainnya
  { id: 'qris', name: 'QRIS', group: 'other' },
  { id: 'ovo', name: 'OVO', group: 'other' },
  { id: 'shopeepay', name: 'ShopeePay', group: 'other' },
  { id: 'alfamart', name: 'Alfamart', group: 'other' },
  { id: 'akulaku', name: 'Akulaku', group: 'other' },
  { id: 'cc', name: 'Kartu Kredit/Debit', group: 'other' },
]

// === Ringkasan Pesanan ===

// Satu item produk yang sedang dibeli (untuk seksi ringkasan produk di checkout)
export type CheckoutItem = {
  id: string
  name: string
  variant?: string // varian terpilih, mis. 'POC Daun 500ml' (opsional — item keranjang belum punya varian)
  quantity: number
  price: number
  imageUrl: string
}

// Placeholder foto produk (TODO: ganti foto asli setelah OMS selesai)
const PLACEHOLDER_IMAGE = '/images/product-placeholder.png'

// Item pesanan dummy untuk ditampilkan & menghitung subtotal secara terstruktur
export const DUMMY_ORDER_ITEMS: CheckoutItem[] = [
  {
    id: 'prod-007',
    name: 'Pupuk Organik Cair (POC) Buah & Sayuran Daun Infarm',
    variant: 'POC Daun 500ml',
    quantity: 2,
    price: 75000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
  {
    id: 'prod-009',
    name: 'Benih Premium Cabai Rawit Unggul',
    variant: 'Isi 50 butir',
    quantity: 3,
    price: 25000,
    imageUrl: PLACEHOLDER_IMAGE,
  },
]

// Subtotal pesanan = jumlah (harga × kuantitas) seluruh item
export const ORDER_SUBTOTAL = DUMMY_ORDER_ITEMS.reduce(
  (sum, item) => sum + item.price * item.quantity,
  0,
)

// Diskon tetap (dummy) yang mengurangi total
export const ORDER_DISCOUNT = 15000
