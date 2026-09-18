// src/types/oms-search.ts
// Bentuk data pencarian cepat di header OMS (GET /api/oms/search).

import type { OrderFulfillmentStatus, OrderPaymentStatus, RefundStatus } from '@/types/order'

// Jenis pencarian yang dijalankan server — hasil pengurai lib/oms-search-query.ts.
export type OmsSearchMode = 'orders' | 'phone' | 'name'

// Satu pesanan di panel hasil. Sengaja RAMPING: tanpa alamat, email, nomor HP, dan item.
// Panel hanya menjawab "pesanan ini sampai mana"; detail lengkap dibuka lewat modal pesanan.
export type OmsSearchResult = {
  orderId: string // nomor invoice
  customerName: string
  date: string // ISO created_at
  status?: OrderFulfillmentStatus
  paymentStatus: OrderPaymentStatus
  paymentMethodLabel?: string // mis. 'BCA · Transfer Bank'
  courier?: string
  trackingNumber?: string
  warehouseName?: string
  totalAmount: number
  refundStatus?: RefundStatus
  // Kolom yang membuat pesanan ini cocok. Membantu admin yang menempel campuran invoice & resi.
  matchedBy: 'invoice' | 'resi' | 'phone' | 'name'
}

export type OmsSearchResponse = {
  mode: OmsSearchMode
  results: OmsSearchResult[]
  // Hanya mode 'orders': nomor yang tidak cocok dengan invoice maupun resi mana pun.
  notFound: string[]
  // true bila hasil dipotong batas (pencarian nama/HP yang cocok dengan terlalu banyak pesanan).
  truncated: boolean
}
