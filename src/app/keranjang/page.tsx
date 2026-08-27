'use client'

// src/app/keranjang/page.tsx
// Halaman Keranjang Belanja. Di LUAR route group (store) → punya header hijau sendiri (CartHeader).
// Sumber data keranjang = cookie (lib/cart-client.ts), dibaca reaktif via useSyncExternalStore.
// Promo aktif diambil REAL dari Supabase lewat API server-only (/api/promotions/active).
// (Rekomendasi paket combo tampil di halaman detail produk, bukan di keranjang.)

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CartLineItem } from '@/types/cart'
import type { Product, StoredProduct } from '@/types/product'
import type { Promotion } from '@/types/promotion'
import { dummyProducts } from '@/lib/data/dummy-products'
import { getRecentlyViewedIds, getAddedToCartIds } from '@/lib/recently-viewed'
import {
  updateQuantity,
  removeFromCart,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
  setCheckoutPromo,
} from '@/lib/cart-client'
import { computePromoProgress, computePromoRewards } from '@/lib/promo-cart'
import CartItemsSkeleton from '@/components/cart/CartItemsSkeleton'

// Store kosong untuk useSyncExternalStore — dipakai hanya sebagai penanda hidrasi (lihat
// `cartHydrated`). Tak pernah memberi notifikasi karena nilainya memang tak pernah berubah.
const subscribeNothing = () => () => {}
import CartHeader from '@/components/cart/CartHeader'
import CartPromoList from '@/components/cart/CartPromoList'
import CartItemRow from '@/components/cart/CartItemRow'
import ProtectionInfo from '@/components/cart/ProtectionInfo'
import CartRecentlyViewed from '@/components/cart/CartRecentlyViewed'
import CartFreeItems, { type FreeItemView } from '@/components/cart/CartFreeItems'
import CartCheckoutBar from '@/components/cart/CartCheckoutBar'

// Kunci unik satu baris keranjang (produk + varian). Tanpa varian → productId saja.
function lineKey(productId: string, variantId?: string): string {
  return variantId ? `${productId}::${variantId}` : productId
}

export default function CartPage() {
  const router = useRouter()

  // === Baca cookie keranjang secara reaktif (tanpa setState di effect) ===
  const cookieCart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  // Penanda "sudah berjalan di browser". Cookie hanya terbaca di klien, jadi render server SELALU
  // melihat keranjang kosong — tanpa penanda ini, HTML dari server memuat pesan "keranjang kosong"
  // yang langsung tergantikan begitu hidrasi selesai.
  //
  // useSyncExternalStore, bukan useState+useEffect: pola itu memanggil setState di dalam effect,
  // yang ditolak aturan lint proyek ini.
  const cartHydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )

  // Set ID produk yang TIDAK dicentang (default: semua tercentang). Hanya state UI, tak masuk cookie.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // Produk OMS dari Supabase (untuk me-resolve detail item keranjang yang ber-id UUID)
  const [omsProducts, setOmsProducts] = useState<StoredProduct[]>([])

  // Kunci permintaan `by-ids` yang SUDAH dijawab server.
  //
  // Dipakai membedakan "keranjang memang kosong" dari "isinya belum bernama". Cookie keranjang
  // hanya memuat { productId, quantity, price }; selama detail produk belum tiba, `items` di bawah
  // membuang setiap baris dan halaman DULU langsung berkata "Keranjang kamu masih kosong" kepada
  // orang yang jelas-jelas baru menaruh barang.
  //
  // Disimpan sebagai kunci (bukan boolean) karena `idsKey` ikut berubah saat riwayat lihat & promo
  // tiba — boolean tak bisa membedakan jawaban untuk daftar yang mana.
  const [answeredIdsKey, setAnsweredIdsKey] = useState<string | null>(null)

  // Promo aktif real dari Supabase (via API server-only)
  const [promos, setPromos] = useState<Promotion[]>([])
  const [loadingPromos, setLoadingPromos] = useState(true)

  // Riwayat "pernah dilihat" & "pernah dimasukkan keranjang" — keduanya dari localStorage.
  //
  // Dibaca saat RENDER (setelah hidrasi), bukan lewat `useEffect` + `setState`. Pola lama melanggar
  // `react-hooks/set-state-in-effect` dan sudah membuat `npm run lint` merah di berkas ini sebelum
  // perubahan ini. Keduanya keadaan TURUNAN dari penyimpanan eksternal, jadi memang tak perlu
  // melewati state sama sekali.
  //
  // `cartHydrated` jadi dependency: localStorage hanya ada di klien.
  const viewedIds = useMemo(
    () => (cartHydrated ? getRecentlyViewedIds() : []),
    [cartHydrated],
  )

  // `cookieCart` SENGAJA jadi dependency meski tak dibaca di dalamnya — mempertahankan perilaku
  // effect yang digantikan. `getAddedToCartIds()` membaca localStorage, saluran yang tak terlihat
  // oleh linter; tanpa dependency ini daftar "pernah di-cart" membeku dan rekomendasi tetap
  // menawarkan produk yang baru saja dimasukkan keranjang.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const addedIds = useMemo(() => (cartHydrated ? getAddedToCartIds() : []), [cartHydrated, cookieCart])

  // === Id produk yang perlu di-resolve dari server: item keranjang + riwayat lihat (gabung unik) ===
  // Key stabil (diurut) supaya effect hanya refetch saat kumpulan id benar-benar berubah.
  const idsKey = useMemo(() => {
    const s = new Set<string>()
    for (const c of cookieCart) s.add(c.productId)
    for (const v of viewedIds) s.add(v)
    // Ikutkan id produk hadiah promo (type free_product) agar detail (nama/foto) siap saat promo tercapai
    for (const p of promos) if (p.type === 'free_product' && p.freeProductId) s.add(p.freeProductId)
    return Array.from(s).sort().join(',')
  }, [cookieCart, viewedIds, promos])

  // === Resolve HANYA produk yang dibutuhkan (bukan seluruh katalog) lewat /api/products/by-ids ===
  // Endpoint ini ber-cache (revalidate 30s) → jauh lebih cepat dari menarik semua produk tiap buka.
  useEffect(() => {
    // Tak ada id yang perlu di-resolve. Daftar produk sengaja TIDAK dikosongkan di sini: itu
    // setState sinkron di dalam effect (ditolak lint), dan tak ada gunanya — tanpa item di
    // keranjang, `omsProducts` memang tak dibaca siapa pun.
    if (!idsKey) return

    const controller = new AbortController()
    fetch(`/api/products/by-ids?ids=${encodeURIComponent(idsKey)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        setOmsProducts(data.products ?? [])
        setAnsweredIdsKey(idsKey)
      })
      .catch(() => {
        // Abort (id berubah) diabaikan; error lain → biarkan daftar produk apa adanya.
        //
        // Tetap ditandai terjawab: tanpa ini halaman terjebak menampilkan kerangka selamanya saat
        // jaringan bermasalah, dan pembeli tak pernah tahu ada yang salah.
        if (!controller.signal.aborted) setAnsweredIdsKey(idsKey)
      })
    return () => controller.abort()
  }, [idsKey])

  // === Minimum total belanja (pengaturan toko). Gagal fetch → 0 = tanpa batas, halaman tetap jalan. ===
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

  // === Ambil promo aktif (server-side filter). Gagal fetch → section promo kosong, halaman aman. ===
  useEffect(() => {
    let active = true
    fetch('/api/promotions/active')
      .then((res) => res.json())
      .then((data: { promotions?: Promotion[] }) => {
        if (active) setPromos(data.promotions ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingPromos(false)
      })
    return () => {
      active = false
    }
  }, [])

  // === Gabungkan item cookie dengan detail produk (nama, foto, harga coret, badge) ===
  // Identitas baris = productId + variantId (produk sama beda varian = baris terpisah).
  const items: CartLineItem[] = useMemo(() => {
    return cookieCart.flatMap((ci) => {
      const product =
        omsProducts.find((p) => p.id === ci.productId) ??
        dummyProducts.find((p) => p.id === ci.productId)
      if (!product) return []
      return [
        {
          productId: ci.productId,
          name: product.name,
          imageUrl: product.imageUrl,
          price: ci.price,
          // Produk bervarian: harga = harga varian (ci.price), tanpa coret. Non-varian: pakai harga produk.
          originalPrice: ci.variantId ? ci.price : product.originalPrice,
          quantity: ci.quantity,
          selected: !excluded.has(lineKey(ci.productId, ci.variantId)),
          badge: product.badge,
          variantId: ci.variantId,
          variantName: ci.variantName,
          // Minimum pembelian hanya ada pada produk OMS (StoredProduct); dummy → 1 (bebas)
          minOrderQty:
            'minOrderQty' in product && typeof product.minOrderQty === 'number'
              ? product.minOrderQty
              : 1,
        },
      ]
    })
  }, [cookieCart, excluded, omsProducts])

  // === Keadaan daftar keranjang: loading / empty / ready ===
  //
  // Sejalan dengan halaman checkout. Yang menentukan KOSONG adalah isi cookie, bukan hasil
  // pemetaannya — cookie sudah terbaca utuh sejak render klien pertama, sedangkan detail produknya
  // menyusul lewat jaringan. Menyimpulkan "kosong" dari hasil pemetaan berarti menyimpulkan dari
  // data yang memang belum tiba.
  //
  // Setiap id keranjang diperiksa sudah pernah dijawab atau belum. Pemeriksaan per-id (bukan
  // membandingkan `idsKey` utuh) penting karena `idsKey` ikut memuat riwayat lihat & produk hadiah
  // promo yang datang belakangan — membandingkan utuh akan menjatuhkan halaman kembali ke keadaan
  // memuat setiap kali promo tiba, padahal item keranjangnya sudah lama bernama.
  const idSudahDijawab = useMemo(
    () => new Set(answeredIdsKey ? answeredIdsKey.split(',') : []),
    [answeredIdsKey],
  )
  const semuaItemSudahDijawab = cookieCart.every((c) => idSudahDijawab.has(c.productId))

  const cartView: 'loading' | 'empty' | 'ready' = !cartHydrated
    ? 'loading'
    : cookieCart.length === 0
      ? 'empty' // cookie memang kosong — diputuskan seketika, tak perlu menunggu jaringan
      : items.length === cookieCart.length
        ? 'ready' // semua baris sudah punya detail
        : !semuaItemSudahDijawab
          ? 'loading' // masih ada id yang belum dijawab server
          : items.length > 0
            ? 'ready' // sebagian produk hilang, sisanya tetap bisa ditampilkan
            : 'empty' // sudah dijawab & tak satu pun produk ketemu (mis. semuanya diarsipkan)

  // === Kalkulasi dinamis (item tercentang) ===
  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items])

  const selectedTotal = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [selectedItems],
  )

  const selectedCount = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.quantity, 0),
    [selectedItems],
  )

  const allSelected = items.length > 0 && items.every((i) => i.selected)

  // === Promo: progres tiap promo + agregasi hadiah yang tercapai (berdasar item tercentang) ===
  const promoProgress = useMemo(() => computePromoProgress(promos, selectedTotal), [promos, selectedTotal])
  const promoRewards = useMemo(() => computePromoRewards(promos, selectedTotal), [promos, selectedTotal])
  const finalTotal = Math.max(0, selectedTotal - promoRewards.totalDiscount)

  // === Produk gratis hadiah (free_product tercapai) → item terpisah Rp0 di keranjang ===
  // Turunan reaktif dari promoRewards: muncul saat subtotal ≥ min_purchase, hilang saat turun.
  // Detail (nama/foto) di-resolve dari produk terbaru; produk diarsipkan / stok habis dilewati.
  const freeItems: FreeItemView[] = useMemo(() => {
    return promoRewards.freeProducts.flatMap((fp) => {
      const product =
        omsProducts.find((p) => p.id === fp.id) ?? dummyProducts.find((p) => p.id === fp.id)
      // Produk OMS diarsipkan atau stok habis → tak bisa jadi hadiah; lewati.
      const stored = omsProducts.find((p) => p.id === fp.id)
      if (stored && (stored.archived || stored.stock <= 0)) return []
      return [
        {
          productId: fp.id,
          name: product?.name ?? fp.name,
          imageUrl: product?.imageUrl ?? '',
          quantity: 1, // aturan promo: 1 produk hadiah
        },
      ]
    })
  }, [promoRewards.freeProducts, omsProducts])

  // === Aksi === (identitas baris = productId + variantId)

  function toggleSelect(productId: string, variantId?: string) {
    const key = lineKey(productId, variantId)
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSelectAll() {
    setExcluded(allSelected ? new Set(items.map((i) => lineKey(i.productId, i.variantId))) : new Set())
  }

  function increment(productId: string, variantId?: string) {
    const item = cookieCart.find((i) => i.productId === productId && i.variantId === variantId)
    if (item) updateQuantity(productId, item.quantity + 1, variantId)
  }

  // Minimum pembelian baris tertentu (dari data produk hasil resolve). Default 1 = bebas.
  function minQtyOf(productId: string, variantId?: string): number {
    const line = items.find((i) => i.productId === productId && i.variantId === variantId)
    return line && line.minOrderQty > 1 ? line.minOrderQty : 1
  }

  function decrement(productId: string, variantId?: string) {
    const item = cookieCart.find((i) => i.productId === productId && i.variantId === variantId)
    if (!item) return
    // Jangan turun di bawah minimum pembelian produk (tombol '−' juga sudah disabled di UI;
    // guard ini menutup jalur lain seperti klik cepat sebelum render ulang).
    const next = Math.max(minQtyOf(productId, variantId), item.quantity - 1)
    if (next !== item.quantity) updateQuantity(productId, next, variantId)
  }

  // Set jumlah langsung (dari input ketik manual). Di-clamp ke minimum pembelian produk.
  function setQuantity(productId: string, quantity: number, variantId?: string) {
    updateQuantity(productId, Math.max(minQtyOf(productId, variantId), quantity), variantId)
  }

  function remove(productId: string, variantId?: string) {
    removeFromCart(productId, variantId)
  }

  // Lanjut ke checkout: simpan item TERCENTANG + snapshot promo/combo yang tercapai.
  function handleCheckout() {
    // Guard: jangan lanjut bila subtotal barang belum mencapai minimum (tombol juga sudah
    // disabled; ini menutup jalur pemanggilan lain).
    if (selectedTotal < minOrderAmount) return
    const chosen = selectedItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
      variantId: i.variantId,
      variantName: i.variantName,
    }))
    setCheckoutItems(chosen)

    // Snapshot promo/combo agar bisa diteruskan ke order nanti
    const selectedIdSet = new Set(selectedItems.map((i) => i.productId))
    const comboIds = Array.from(
      new Set(
        cookieCart
          .filter((c) => selectedIdSet.has(c.productId) && c.comboId)
          .map((c) => c.comboId as string),
      ),
    )
    setCheckoutPromo({
      promoIds: promoRewards.reachedPromoIds,
      freeShipping: promoRewards.freeShipping,
      discountTotal: promoRewards.totalDiscount,
      freeProductIds: promoRewards.freeProducts.map((f) => f.id),
      comboIds,
    })

    router.push('/checkout')
  }

  // Produk "Dilihat Sebelumnya": resolve id riwayat → data produk terbaru (OMS + dummy),
  // buang yang diarsipkan atau sudah ada di keranjang. Urut sesuai riwayat (terbaru dulu).
  const recentlyViewed = useMemo(() => {
    const cartIds = new Set(cookieCart.map((i) => i.productId))
    const addedSet = new Set(addedIds) // produk yang PERNAH di-cart (walau sudah dihapus)
    const byId = new Map<string, Product>()
    for (const p of dummyProducts) byId.set(p.id, p)
    for (const p of omsProducts) {
      if (p.archived) byId.delete(p.id) // diarsipkan → jangan rekomendasikan
      else byId.set(p.id, p) // data terbaru dari Supabase (harga/stok bisa berubah)
    }
    return viewedIds
      .filter((id) => !cartIds.has(id)) // jangan rekomendasi barang yang sedang di keranjang
      .filter((id) => !addedSet.has(id)) // maupun yang PERNAH di-cart (fokus produk murni dibrowse)
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, 6)
  }, [viewedIds, omsProducts, cookieCart, addedIds])

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface text-zinc-900">
      {/* 1 — Header hijau dengan tombol kembali + judul */}
      <CartHeader />

      {/* 2 — Promo aktif (real dari Supabase): progress bar / pesan sukses per promo */}
      <CartPromoList promos={promoProgress} loading={loadingPromos} />

      {/* pb-24: ruang agar konten tak tertutup bilah checkout bawah yang fixed */}
      <main className="flex-1 pb-24">
        {/* Desktop (lg+): dua kolom — kiri (produk+hadiah+perlindungan) 8/12, kanan (dilihat sebelumnya)
            4/12. Mobile/tablet: satu kolom (kanan turun ke bawah kiri) seperti sebelumnya. */}
        <div className="mx-auto w-full max-w-6xl lg:grid lg:grid-cols-12 lg:gap-6 lg:px-6 lg:pt-3">
          {/* === Kolom kiri: konten transaksi utama === */}
          <div className="lg:col-span-8">
            {/* 3 — Daftar item keranjang */}
            {/* Tiga keadaan, bukan dua. Pesan "masih kosong" HANYA setelah dipastikan kosong —
                sebelumnya ia juga muncul selama detail produk masih dalam perjalanan. */}
            {cartView === 'loading' ? (
              <CartItemsSkeleton rows={cookieCart.length || 1} />
            ) : cartView === 'ready' ? (
              <div className="mt-3 divide-y divide-zinc-100 lg:mt-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-zinc-100">
                {items.map((item) => (
                  <CartItemRow
                    key={lineKey(item.productId, item.variantId)}
                    item={item}
                    onToggleSelect={toggleSelect}
                    onIncrement={increment}
                    onDecrement={decrement}
                    onSetQuantity={setQuantity}
                    onRemove={remove}
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 py-16 text-center text-sm text-zinc-400">Keranjang kamu masih kosong.</p>
            )}

            {/* 3b — Produk gratis hadiah promo (muncul otomatis saat syarat min_purchase tercapai) */}
            <CartFreeItems items={freeItems} />

            {/* 4 — Informasi perlindungan */}
            <ProtectionInfo />
          </div>

          {/* === Kolom kanan: rekomendasi "Dilihat Sebelumnya" (di bawah kiri pada mobile) === */}
          <div className="lg:col-span-4">
            <CartRecentlyViewed products={recentlyViewed} />
          </div>
        </div>
      </main>

      {/* 6 — Bilah checkout bawah (sticky); total sudah dikurangi diskon promo */}
      <CartCheckoutBar
        allSelected={allSelected}
        selectedCount={selectedCount}
        selectedTotal={finalTotal}
        subtotal={selectedTotal}
        minOrderAmount={minOrderAmount}
        onToggleSelectAll={toggleSelectAll}
        onCheckout={handleCheckout}
      />
    </div>
  )
}
