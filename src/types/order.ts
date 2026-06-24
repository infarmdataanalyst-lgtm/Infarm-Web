// src/types/order.ts
// Tipe data pesanan (order) untuk mock database lokal & OMS.
// Dipakai bersama oleh API route ecommerce (tulis) dan dashboard OMS (baca).

// Satu baris item produk di dalam sebuah pesanan
export type OrderItem = {
  productId: string
  name: string
  quantity: number
  price: number // harga satuan saat checkout (dalam Rupiah)
}

// Status pembayaran pesanan; sengaja dibatasi agar konsisten dengan badge di OMS
export type OrderPaymentStatus = 'Lunas' | 'Menunggu' | 'Gagal'

// Status alur (fulfillment) pesanan — dipakai sebagai tab filter di halaman Pesanan OMS
export type OrderFulfillmentStatus =
  | 'Menunggu Pembayaran'
  | 'Diproses'
  | 'Dikirim'
  | 'Selesai'
  | 'Dibatalkan'

// Informasi logistik/pengiriman pesanan
export type OrderLogistics = {
  courier: string // mis. 'JNE'
  service: string // mis. 'Reguler'
}

// Pesanan lengkap yang disimpan di orders.json
export type Order = {
  orderId: string
  customerName: string
  customerPhone?: string
  customerEmail?: string // untuk kirim konfirmasi pesanan ke buyer
  date: string // ISO date string, mis. '2026-06-15T14:20:00.000Z'
  items: OrderItem[]
  totalAmount: number
  paymentStatus: OrderPaymentStatus
  status?: OrderFulfillmentStatus // alur pesanan; default diisi saat saveOrder
  logistics?: OrderLogistics // kurir & layanan pengiriman
  trackingNumber?: string // nomor resi
}

// Payload yang dikirim halaman sukses checkout ke API (sebelum disimpan).
// paymentStatus opsional — default 'Lunas' karena dikirim setelah pembayaran sukses.
export type CreateOrderInput = {
  orderId: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  date: string
  items: OrderItem[]
  totalAmount: number
  paymentStatus?: OrderPaymentStatus
  status?: OrderFulfillmentStatus
  logistics?: OrderLogistics
  trackingNumber?: string
}
