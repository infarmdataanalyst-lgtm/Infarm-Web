'use client'

// src/components/product/StickyBuyBar.tsx
// Bilah aksi produk: "Beli Langsung" & "+ Keranjang".
// MOBILE (< lg): mengambang (fixed) di dasar layar — layar sempit, CTA harus selalu terjangkau.
// DESKTOP (lg+): STATIS, mengalir di kolom kanan tepat di bawah harga/rating/terjual, karena di
// layar lebar bilah mengambang malah menutupi konten saat men-scroll.
// Tombol "+ Keranjang" memicu animasi terbang ke ikon keranjang; cookie & badge baru di-update
// SAAT animasi tiba di ikon (lihat handleFlyComplete).

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { addToCart, setCheckoutItems, showCartToast, CART_BUMP_EVENT } from '@/lib/cart-client'
import { trackAddToCart } from '@/lib/analytics'
import { formatRupiah } from '@/lib/format'
import FlyToCart, { type FlyPoint } from '@/components/product/FlyToCart'
import { useStickyBarHeight } from '@/hooks/use-sticky-bar-height'
import BottomSheet from '@/components/checkout/BottomSheet'
import VariantChips from '@/components/product/VariantChips'
import type { ProductVariant } from '@/types/variant'
import {
  subscribeVariant,
  getSelectedVariant,
  getServerSelectedVariant,
  setSelectedVariant,
  pickDefaultVariant,
  toSelectedVariant,
} from '@/lib/variant-selection'

// Satu partikel animasi yang sedang berjalan
type Particle = { id: number; start: FlyPoint; end: FlyPoint }

// Menampilkan dua tombol aksi utama, animasi fly-to-cart, dan penyimpanan keranjang berbasis cookie.
export default function StickyBuyBar({
  productId,
  price,
  name,
  category,
  sku,
  variants = [],
  minOrderQty = 1,
}: {
  productId: string
  price: number
  name: string // untuk payload GA4 add_to_cart
  category: string
  sku?: string
  variants?: ProductVariant[] // varian produk (kosong = produk tak bervarian → perilaku lama)
  minOrderQty?: number // minimum pembelian produk (1 = bebas) → jumlah awal saat masuk keranjang
}) {
  // Sekali klik menambahkan sebanyak minimum pembelian, bukan selalu 1 pcs. Produk murah
  // (mis. Rp300) baru masuk akal dikirim dalam kelipatan tertentu — lihat store_settings.
  const addQty = minOrderQty > 1 ? minOrderQty : 1
  const router = useRouter()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const particleId = useRef(0) // penghasil id unik tiap partikel
  const [particles, setParticles] = useState<Particle[]>([])
  const [justAdded, setJustAdded] = useState(false)

  const hasVariants = variants.length > 0
  const selectedStore = useSyncExternalStore(
    subscribeVariant,
    getSelectedVariant,
    getServerSelectedVariant,
  )

  // Deteksi mobile (< lg): dipakai dua hal — pilihan varian lewat bottom-sheet (bukan chip inline)
  // DAN penentuan apakah bilah ini sedang mengambang.
  const isMobile = useMediaQuery('(max-width: 1023px)')

  // Bottom-sheet varian (mobile): intent 'add' (ke keranjang) atau 'buy' (beli langsung).
  const [sheetIntent, setSheetIntent] = useState<'add' | 'buy' | null>(null)

  // Publikasikan tinggi bilah ke --sticky-bar-h (dipakai FloatingWhatsApp agar tak bertabrakan).
  // Hanya saat mengambang: di desktop bilah ikut mengalir, jadi tak ada yang perlu dihindari.
  const barRef = useStickyBarHeight<HTMLDivElement>(isMobile)

  // Seed varian default ke store (jaga-jaga bila StickyBuyBar ter-mount sebelum VariantSelector).
  useEffect(() => {
    if (!hasVariants) return
    const def = pickDefaultVariant(variants)
    if (def) setSelectedVariant(toSelectedVariant(productId, def))
  }, [hasVariants, productId, variants])

  // Varian aktif untuk produk ini (dari store, fallback default). null bila produk tak bervarian.
  const activeVariant = hasVariants
    ? selectedStore && selectedStore.productId === productId
      ? selectedStore
      : (() => {
          const def = pickDefaultVariant(variants)
          return def ? toSelectedVariant(productId, def) : null
        })()
    : null

  // Harga efektif = harga varian bila bervarian, else harga produk. Stok habis → tombol nonaktif.
  const effectivePrice = activeVariant ? activeVariant.price : price
  const outOfStock = hasVariants && (!activeVariant || activeVariant.stock <= 0)
  // Di mobile+bervarian, tombol bar SELALU aktif (pemilihan varian & cek stok terjadi di bottom-sheet).
  const barOutOfStock = outOfStock && !(hasVariants && isMobile)

  // Menyimpan ke cookie + memicu efek pop pada ikon. Dipakai saat animasi tiba (atau fallback).
  const commitAdd = useCallback(() => {
    addToCart({
      productId,
      quantity: addQty,
      price: effectivePrice,
      variantId: activeVariant?.variantId,
      variantName: activeVariant?.name,
    })
    // GA4 add_to_cart: dikirim SETELAH item masuk cookie keranjang (bukan sebelum)
    trackAddToCart({ id: productId, sku, name, category, price: effectivePrice }, addQty)
    window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT)) // pop ikon keranjang
    showCartToast() // toast sukses
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1500)
  }, [productId, addQty, effectivePrice, activeVariant, sku, name, category])

  // Klik "+ Keranjang": di mobile & produk bervarian → buka bottom-sheet pilih varian dulu.
  function handleAddToCart() {
    if (hasVariants && isMobile) {
      setSheetIntent('add')
      return
    }
    if (outOfStock) return // varian terpilih habis → jangan tambah
    const cartEl = document.getElementById('cart-anchor')
    const button = addButtonRef.current

    // Fallback: bila ikon keranjang tak ditemukan (mis. halaman tanpa header), langsung simpan.
    if (!cartEl || !button) {
      commitAdd()
      return
    }

    const b = button.getBoundingClientRect()
    const c = cartEl.getBoundingClientRect()

    // Titik awal = tengah tombol; titik akhir = tengah ikon keranjang (koordinat viewport)
    const start: FlyPoint = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    const end: FlyPoint = { x: c.left + c.width / 2, y: c.top + c.height / 2 }

    particleId.current += 1
    setParticles((prev) => [...prev, { id: particleId.current, start, end }])
  }

  // Saat animasi sebuah partikel tiba di ikon: hapus partikel + commit ke cookie.
  const handleFlyComplete = useCallback(
    (id: number) => {
      setParticles((prev) => prev.filter((p) => p.id !== id))
      commitAdd()
    },
    [commitAdd],
  )

  // "Beli Langsung": masukkan ke keranjang, lalu set item checkout = HANYA produk ini, baru ke /checkout.
  // setCheckoutItems wajib dipanggil karena halaman /checkout membaca cookie checkout (infarm_checkout),
  // bukan seluruh isi keranjang. Tanpa ini, checkout menampilkan snapshot lama / dummy (produk berbeda).
  function handleBuyNow() {
    if (hasVariants && isMobile) {
      setSheetIntent('buy')
      return
    }
    doBuyNow()
  }

  // Eksekusi beli langsung (dipakai tombol desktop & konfirmasi sheet mobile).
  function doBuyNow() {
    if (outOfStock) return // varian terpilih habis → jangan lanjut
    const item = {
      productId,
      quantity: addQty,
      price: effectivePrice,
      variantId: activeVariant?.variantId,
      variantName: activeVariant?.name,
    }
    addToCart(item)
    setCheckoutItems([item])
    router.push('/checkout')
  }

  // Konfirmasi dari bottom-sheet: jalankan aksi sesuai intent, lalu tutup sheet.
  function confirmSheet() {
    if (outOfStock) return
    if (sheetIntent === 'buy') doBuyNow()
    else commitAdd()
    setSheetIntent(null)
  }

  return (
    <>
      {/* ref: mendaftarkan tinggi bilah ke --sticky-bar-h agar FloatingWhatsApp naik di atasnya.
          `lg:static` melepas bilah dari mode mengambang di desktop — ia lalu mengalir sebagai blok
          biasa di kolom kanan (lihat penempatannya di halaman detail produk). Di desktop latar putih,
          border, dan padding samping DILEPAS supaya yang tampak murni tombolnya saja, bukan panel. */}
      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white lg:static lg:z-auto lg:border-0 lg:bg-transparent"
      >
        {/* Info minimum pembelian — muncul tepat di atas tombol beli agar pembeli tahu sebelum
            menekan, bukan kaget saat melihat jumlah di keranjang. */}
        {addQty > 1 && (
          <p className="mx-auto max-w-6xl px-4 pt-2 text-xs text-orange-700 lg:mx-0 lg:max-w-none lg:px-0 lg:pt-0">
            Min. beli {addQty} pcs — sekali tambah langsung {addQty} pcs.
          </p>
        )}
        {/* max-w-6xl+mx-auto hanya relevan saat bilah selebar layar (mobile); di desktop bilah sudah
            dibatasi lebar kolomnya sendiri. */}
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 lg:mx-0 lg:max-w-none lg:px-0 lg:py-0">
          {barOutOfStock ? (
            // Varian terpilih habis → satu tombol nonaktif "Stok Habis"
            <button
              type="button"
              disabled
              className="flex-1 cursor-not-allowed rounded-xl bg-zinc-200 py-3 text-base font-bold text-zinc-400"
            >
              Stok Habis
            </button>
          ) : (
            <>
              {/* Tombol "Beli Langsung" — putih, border hitam */}
              <button
                type="button"
                onClick={handleBuyNow}
                className="flex-1 rounded-xl border-2 border-zinc-900 bg-white py-3 font-heading text-base font-bold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99]"
              >
                Beli Langsung
              </button>

              {/* Tombol "+ Keranjang" — hijau brand */}
              <button
                ref={addButtonRef}
                type="button"
                onClick={handleAddToCart}
                className="flex-1 rounded-xl bg-brand-primary py-3 font-heading text-base font-bold text-white shadow-sm transition hover:brightness-90 active:scale-[0.99]"
              >
                {justAdded ? '✓ Ditambahkan' : '+ Keranjang'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Partikel animasi terbang (di-portal ke body oleh FlyToCart) */}
      {particles.map((p) => (
        <FlyToCart
          key={p.id}
          start={p.start}
          end={p.end}
          onComplete={() => handleFlyComplete(p.id)}
        />
      ))}

      {/* Bottom-sheet pilih varian (mobile) — muncul saat menekan +Keranjang / Beli Langsung */}
      {hasVariants && (
        <BottomSheet open={sheetIntent !== null} onClose={() => setSheetIntent(null)}>
          <div className="px-5 pb-6 pt-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Pilih Varian</h3>
                <p className="mt-0.5 text-sm text-zinc-500">{name}</p>
              </div>
              <button
                type="button"
                onClick={() => setSheetIntent(null)}
                aria-label="Tutup"
                className="rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            {/* Harga + stok varian terpilih */}
            <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-bold text-brand-primary">{formatRupiah(effectivePrice)}</span>
              <span className={`text-sm ${outOfStock ? 'text-red-500' : 'text-zinc-500'}`}>
                {outOfStock ? 'Stok habis' : `Stok: ${activeVariant?.stock ?? 0}`}
              </span>
            </div>

            <VariantChips productId={productId} variants={variants} />

            {/* Tombol konfirmasi sesuai intent */}
            <button
              type="button"
              onClick={confirmSheet}
              disabled={outOfStock}
              className="mt-5 w-full rounded-xl bg-brand-primary py-3 font-heading text-base font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              {outOfStock
                ? 'Stok Habis'
                : sheetIntent === 'buy'
                  ? 'Beli Sekarang'
                  : 'Tambahkan ke Keranjang'}
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
