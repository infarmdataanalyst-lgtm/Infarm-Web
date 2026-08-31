// src/types/order.ts
// Tipe data pesanan (order) untuk OMS & ecommerce.
// CATATAN: tipe ini APP-FACING (camelCase, status Bahasa Indonesia). Skema DB Supabase
// memakai kolom Bahasa Indonesia + enum English (PENDING/PAID/...) yang dipetakan di
// src/lib/mock-db/orders.ts. UI tidak perlu tahu skema DB — cukup tipe ini.

// Satu baris item produk di dalam sebuah pesanan
export type OrderItem = {
  productId: string
  name: string // di-resolve dari tabel products saat baca (order_items tak menyimpan nama)
  imageUrl?: string // di-resolve dari products.image_url saat baca (order_items tak menyimpan foto)
  quantity: number
  price: number // harga satuan saat checkout (snapshot = price_at_purchase). 0 untuk produk gratis promo.
  isPromoItem?: boolean // true = produk GRATIS hadiah promosi (type='free_product'); tak menambah subtotal
  promotionId?: string | null // id promosi penyebab produk ini gratis (null untuk item normal)
  variantId?: string | null // varian produk yang dipilih (null bila produk tak bervarian)
  variantName?: string // nama varian di-resolve saat baca (mis. "50 Biji") — untuk tampilan invoice
}

// Status pembayaran pesanan (app-facing). DB: PENDING→Menunggu, PAID→Lunas, FAILED→Gagal.
export type OrderPaymentStatus = 'Lunas' | 'Menunggu' | 'Gagal'

// Status alur (fulfillment) pesanan (app-facing) — dipakai tab filter di OMS.
// DB: PENDING→'Menunggu Pembayaran', PROCESSING→Diproses, SHIPPED→Dikirim,
//     COMPLETED→Selesai, CANCELLED→Dibatalkan.
export type OrderFulfillmentStatus =
  | 'Menunggu Pembayaran'
  | 'Diproses'
  | 'Dikirim'
  | 'Selesai'
  | 'Dibatalkan'

// Informasi logistik/pengiriman pesanan
export type OrderLogistics = {
  courier: string // nama_ekspedisi, mis. 'JNE'
  service: string // jenis_layanan, mis. 'Reguler'
}

// Alamat pengiriman terstruktur (dari input form + hasil search Mengantar)
export type OrderShippingAddress = {
  shippingAddress: string // nama jalan / detail alamat
  provinsi: string
  kota: string
  kecamatan: string
  kelurahan: string
  kodepos: string
  destinationId: string // _id kelurahan Mengantar (untuk cek ongkir & booking kurir)
}

// Pesanan lengkap
export type Order = {
  orderId: string // = nomor_invoice (mis. INV-20260601-4821)
  customerName: string
  customerPhone?: string
  customerEmail?: string // untuk kirim konfirmasi pesanan ke buyer
  date: string // ISO date = created_at
  items: OrderItem[]
  totalAmount: number // = jumlah_total (subtotal + ongkir - diskon)
  // = ongkos_kirim. Bagian ongkir DARI totalAmount, disimpan terpisah supaya bisa direkonsiliasi
  // dengan tagihan Mengantar. `undefined` untuk pesanan yang dibuat sebelum kolomnya ada — itu
  // BUKAN berarti gratis ongkir (nilai 0 yang berarti gratis).
  shippingCost?: number
  paymentStatus: OrderPaymentStatus
  status?: OrderFulfillmentStatus
  logistics?: OrderLogistics
  trackingNumber?: string // no_tracking (diisi setelah kurir pickup)
  transactionId?: string // id_transaksi (dari Xendit setelah pembayaran)
  // = metode_pembayaran. Metode/channel yang BENAR-BENAR dipakai pembeli menurut Xendit
  // (mis. 'BCA', 'OVO', 'QRIS', 'ALFAMART'). Hanya diketahui setelah callback pembayaran masuk —
  // di jalur invoice pembeli memilih metodenya sendiri di halaman Xendit, jadi `undefined` selama
  // tagihan belum dibayar, dan juga untuk pesanan yang dibuat sebelum kolomnya ada.
  paymentMethod?: string
  address?: OrderShippingAddress
  warehouseId?: string // gudang pemenuh pesanan (orders.warehouse_id); undefined untuk pesanan lama
  // Nama gudang pemenuh, di-resolve saat baca (join ke tabel warehouses). Hanya untuk TAMPILAN OMS —
  // tak pernah dikirim ke storefront. undefined bila pesanan lama (warehouse_id NULL) atau gudangnya
  // sudah dihapus; UI menampilkannya sebagai "Belum ditentukan".
  warehouseName?: string
  // Hasil booking kurir Mengantar. undefined = belum pernah dicoba (pesanan lama / belum dibayar).
  // FAILED = pembayaran sudah masuk tapi resi gagal terbit -> WAJIB ditindaklanjuti admin.
  shipmentStatus?: "BOOKED" | "FAILED"
  shipmentError?: string // alasan kegagalan terakhir (untuk admin OMS)
  shipmentBookedAt?: string // ISO, kapan resi terbit
}

// Payload dari checkout ke API (sebelum disimpan). nomor_invoice digenerate di server.
// paymentStatus/status opsional — default 'Menunggu'/'Menunggu Pembayaran' (DB PENDING)
// karena pembayaran belum dikonfirmasi (Xendit menyusul).
export type CreateOrderInput = {
  customerName: string
  customerPhone?: string
  customerEmail?: string
  items: OrderItem[]
  totalAmount: number
  // Ongkir hasil verifikasi SERVER terhadap tarif Mengantar — bukan angka mentah dari client.
  // Diteruskan ke RPC agar tersimpan di kolomnya sendiri, bukan hanya melebur ke totalAmount.
  shippingCost?: number
  logistics?: OrderLogistics
  address: OrderShippingAddress
  paymentStatus?: OrderPaymentStatus
  status?: OrderFulfillmentStatus
  warehouseId?: string // gudang hasil resolveWarehouseForOrder; kosong → RPC pakai gudang default
}

// Agregasi produk terlaris — jumlah unit terjual & total pendapatan per produk.
// Dihitung on-demand dari order_items (tidak disimpan sebagai kolom terpisah).
export type BestSellingProduct = {
  productId: string
  name: string
  totalSold: number // total unit terjual (jumlah quantity)
  totalRevenue: number // total pendapatan dari produk ini (quantity * price)
}
