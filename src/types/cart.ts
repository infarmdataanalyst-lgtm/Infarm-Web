// src/types/cart.ts
// Tipe data keranjang & cookie keranjang (lihat aturan cookie di CLAUDE.md).

// Satu item di keranjang. Hanya menyimpan data non-sensitif (ID produk, jumlah, harga).
// comboId terisi bila item ditambahkan sebagai bagian dari paket/combo (untuk dibedakan saat checkout).
export type CartItem = {
  productId: string
  quantity: number
  price: number
  comboId?: string
}

// Ringkasan promo/combo yang tercapai saat checkout — disimpan ke cookie agar bisa diteruskan
// ke pembuatan order nanti (lihat lib/cart-client setCheckoutPromo). Belum disensitif.
export type CheckoutPromoSnapshot = {
  promoIds: string[] // promo yang tercapai
  freeShipping: boolean // ongkir dibebaskan
  discountTotal: number // total diskon (nominal + persen) dalam rupiah
  freeProductIds: string[] // produk hadiah dari promo free_product
  comboIds: string[] // combo yang dibeli (dari item keranjang terpilih)
}

// Item keranjang yang sudah digabung dengan info produk (untuk tampilan halaman keranjang).
// Gabungan CartItem (dari cookie) + detail produk (nama, foto, harga coret) + status terpilih.
export type CartLineItem = {
  productId: string
  name: string
  imageUrl: string
  price: number // harga jual efektif (promo)
  originalPrice: number
  quantity: number
  selected: boolean
  badge?: string
}
