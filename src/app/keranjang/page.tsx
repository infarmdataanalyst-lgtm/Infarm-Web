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
import type { ProductCombo } from '@/types/combo'
import { dummyProducts } from '@/lib/data/dummy-products'
import { getRecentlyViewedIds, getAddedToCartIds } from '@/lib/recently-viewed'
import {
  updateQuantity,
  removeFromCart,
  removeComboFromCart,
  setComboCountInCart,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
  setCheckoutPromo,
} from '@/lib/cart-client'
import {
  computeOrderPromos,
  computePromoProgress,
  computePromoRewards,
  unavailableGiftIds,
} from '@/lib/promo-cart'
import { cartLineKey, comboMultiplier } from '@/lib/cart-lines'
import CartItemsSkeleton from '@/components/cart/CartItemsSkeleton'

// Store kosong untuk useSyncExternalStore — dipakai hanya sebagai penanda hidrasi (lihat
// `cartHydrated`). Tak pernah memberi notifikasi karena nilainya memang tak pernah berubah.
const subscribeNothing = () => () => {}
import CartHeader from '@/components/cart/CartHeader'
import CartPromoList from '@/components/cart/CartPromoList'
import CartItemRow from '@/components/cart/CartItemRow'
import CartComboGroup, { type CartComboGroupView } from '@/components/cart/CartComboGroup'
import ProtectionInfo from '@/components/cart/ProtectionInfo'
import CartRecentlyViewed from '@/components/cart/CartRecentlyViewed'
import CartFreeItems, { type FreeItemView } from '@/components/cart/CartFreeItems'
import CartCheckoutBar from '@/components/cart/CartCheckoutBar'

// Kunci unik satu baris keranjang: produk + varian + PAKET. Produk A di dalam paket dan A yang
// dibeli satuan adalah dua baris berbeda (lihat lib/cart-lines.ts).
function lineKey(item: { productId: string; variantId?: string; comboId?: string }): string {
  return cartLineKey(item)
}

// Kunci stok: produk + varian, TANPA paket — A paket dan A satuan mengambil dari stok yang sama.
function stockKey(item: { productId: string; variantId?: string }): string {
  return `${item.productId}::${item.variantId ?? ''}`
}

// Satu entri daftar keranjang: baris satuan, atau satu paket utuh beserta anggotanya.
type CartEntry =
  | { kind: 'line'; item: CartLineItem }
  | { kind: 'combo'; group: CartComboGroupView }

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
  // Plafon diskon dari server (default aman bila endpoint promo gagal dimuat).
  const [maxDiscountPercent, setMaxDiscountPercent] = useState(50)
  // Jam acuan evaluasi promo, diambil SEKALI saat daftar promo tiba.
  // Date.now() tak boleh dipanggil saat render (aturan kemurnian React): nilainya berubah tiap
  // render sehingga hasil useMemo tak stabil. Diambil bersamaan dengan promonya justru lebih benar
  // secara semantik — keduanya potret keadaan pada saat yang sama.
  const [promoNowMs, setPromoNowMs] = useState(0)

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
      .then((data: { promotions?: Promotion[]; maxDiscountPercent?: number }) => {
        if (!active) return
        setPromos(data.promotions ?? [])
        setPromoNowMs(Date.now())
        // Plafon diskon dititipkan di endpoint promo supaya keranjang memakai angka yang SAMA
        // dengan yang dipakai server saat menagih (lihat computeOrderPromos).
        if (typeof data.maxDiscountPercent === 'number') {
          setMaxDiscountPercent(data.maxDiscountPercent)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingPromos(false)
      })
    return () => {
      active = false
    }
  }, [])

  // === Definisi paket aktif (nama & isi per paket) ===
  //
  // Dipakai untuk judul paket, menghitung jumlah paket (N), dan MENANDAI paket yang isinya sudah
  // tak cocok dengan database sebelum pembeli menekan bayar — dulu itu baru ketahuan saat server
  // menolak di checkout. `null` = belum/tidak termuat: keranjang lalu tak menilai sah-tidaknya
  // paket (server tetap menegakkannya) supaya gangguan jaringan tak mengunci checkout.
  const [combos, setCombos] = useState<ProductCombo[] | null>(null)
  const adaPaket = cookieCart.some((c) => c.comboId)
  useEffect(() => {
    if (!adaPaket) return
    let active = true
    fetch('/api/combos/active')
      .then((res) => res.json())
      .then((data: { combos?: ProductCombo[] }) => {
        if (active && Array.isArray(data.combos)) setCombos(data.combos)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [adaPaket])

  // === Gabungkan item cookie dengan detail produk (nama, foto, harga coret, badge) ===
  // Identitas baris = productId + variantId + comboId (lihat lineKey).
  const lineItems: CartLineItem[] = useMemo(() => {
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
          selected: !excluded.has(lineKey(ci)),
          badge: product.badge,
          variantId: ci.variantId,
          variantName: ci.variantName,
          // Minimum pembelian hanya ada pada produk OMS (StoredProduct); dummy → 1 (bebas)
          minOrderQty:
            'minOrderQty' in product && typeof product.minOrderQty === 'number'
              ? product.minOrderQty
              : 1,
          // Stok hanya diketahui untuk produk OMS. Tanpa ini keranjang tak pernah menampilkan
          // stok dan tombol "+" tak punya batas — pembeli baru tahu saat checkout ditolak 409.
          ...('stock' in product && typeof product.stock === 'number'
            ? { stock: product.stock }
            : {}),
          // Penanda paket: baris ini tampil di dalam grup paketnya, tanpa kontrol sendiri.
          ...(ci.comboId ? { comboId: ci.comboId } : {}),
        },
      ]
    })
  }, [cookieCart, excluded, omsProducts])

  // Stok yang tersisa UNTUK SATU BARIS = stok produk − jumlah di baris lain (yang tercentang) dari
  // produk/varian yang sama. Produk A kini bisa muncul dua kali (di paket & satuan); tanpa ini
  // masing-masing baris membandingkan dirinya dengan stok penuh dan keduanya tampak cukup.
  const items: CartLineItem[] = useMemo(() => {
    const dipakai = new Map<string, number>()
    for (const i of lineItems) {
      if (i.selected) dipakai.set(stockKey(i), (dipakai.get(stockKey(i)) ?? 0) + i.quantity)
    }
    return lineItems.map((i) => {
      if (typeof i.stock !== 'number') return i
      const lain = (dipakai.get(stockKey(i)) ?? 0) - (i.selected ? i.quantity : 0)
      return { ...i, stock: Math.max(0, i.stock - lain) }
    })
  }, [lineItems])

  // === Susun daftar: baris satuan apa adanya, anggota paket dikumpulkan jadi satu entri paket ===
  // Paket muncul di posisi anggota pertamanya, jadi urutan keranjang tetap seperti yang dimasukkan.
  const entries: CartEntry[] = useMemo(() => {
    const urutan: ({ kind: 'line'; item: CartLineItem } | { kind: 'combo'; comboId: string })[] = []
    const anggotaPaket = new Map<string, CartLineItem[]>()
    for (const item of items) {
      if (!item.comboId) {
        urutan.push({ kind: 'line', item })
        continue
      }
      const members = anggotaPaket.get(item.comboId)
      if (members) {
        members.push(item)
      } else {
        anggotaPaket.set(item.comboId, [item])
        urutan.push({ kind: 'combo', comboId: item.comboId })
      }
    }

    return urutan.map((entry): CartEntry => {
      if (entry.kind === 'line') return entry
      const { comboId } = entry
      const members = anggotaPaket.get(comboId) ?? []
      const def = combos?.find((c) => c.id === comboId)
      const units = def?.items ?? []
      // Belum termuat → jumlah paket tak bisa dinilai; tampilkan jumlah anggota pertama apa adanya
      // (paket lama selalu 1). Termuat tapi tak ketemu = paket dinonaktifkan/dihapus → rusak.
      const count =
        combos === null ? 1 : def ? comboMultiplier(units, members) : null
      // Batas atas N dari stok: per anggota, stok yang tersisa untuk barisnya ÷ isi per paket.
      let maxCount: number | null = null
      for (const m of members) {
        const unit = units.find((u) => u.productId === m.productId)?.quantity
        if (typeof m.stock !== 'number' || !unit) continue
        const cukup = Math.floor(m.stock / unit)
        maxCount = maxCount === null ? cukup : Math.min(maxCount, cukup)
      }
      return {
        kind: 'combo',
        group: {
          comboId,
          name: def?.name ?? 'Paket',
          members,
          selected: members.every((m) => m.selected),
          count,
          maxCount,
        },
      }
    })
  }, [items, combos])

  // Ada baris yang stoknya tak mencukupi → checkout dikunci sampai pembeli membetulkannya.
  // Sebelumnya kekurangan stok hanya ketahuan di server, SESUDAH pembeli menekan bayar.
  const adaStokKurang = useMemo(
    () => items.some((i) => i.selected && typeof i.stock === 'number' && i.stock < i.quantity),
    [items],
  )

  // Paket tercentang yang isinya tak lagi cocok dengan database → checkout dikunci; server pasti
  // menolaknya, dan pesan di kepala paket memberi tahu cara membetulkannya.
  const adaPaketRusak = useMemo(
    () => entries.some((e) => e.kind === 'combo' && e.group.selected && e.group.count === null),
    [entries],
  )

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
  // Hadiah yang stoknya habis di semua gudang → pesan promo jujur, bukan "Selamat!"
  const hadiahHabis = useMemo(() => unavailableGiftIds(promos, omsProducts), [promos, omsProducts])
  const promoProgress = useMemo(
    () => computePromoProgress(promos, selectedTotal, hadiahHabis),
    [promos, selectedTotal, hadiahHabis],
  )
  const promoRewards = useMemo(() => computePromoRewards(promos, selectedTotal), [promos, selectedTotal])

  // ANGKA UANG diambil dari computeOrderPromos — fungsi yang SAMA PERSIS dengan yang dipakai
  // /api/orders/create saat menagih. computePromoRewards di atas kini hanya menyuplai daftar produk
  // hadiah & pesan progres, bukan lagi nominal diskon.
  //
  // ongkir 0 dan minTotal 0 di sini disengaja: keranjang belum tahu kurir mana yang akan dipilih,
  // jadi lantai nominal gateway belum bisa dievaluasi dengan benar di sini. Yang menegakkannya
  // adalah halaman checkout (sudah tahu ongkirnya) dan server.
  const orderPromos = useMemo(
    () =>
      computeOrderPromos(promos, selectedTotal, 0, promoNowMs, {
        maxDiscountPercent,
        minTotal: 0,
      }),
    [promos, selectedTotal, maxDiscountPercent],
  )
  const finalTotal = Math.max(0, selectedTotal - orderPromos.discount)

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
    const key = lineKey({ productId, variantId })
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSelectAll() {
    setExcluded(allSelected ? new Set(items.map((i) => lineKey(i))) : new Set())
  }

  // Centang paket = centang SEMUA anggotanya sekaligus; paket separuh tercentang tak bisa dibayar.
  function toggleSelectCombo(comboId: string) {
    const keys = items.filter((i) => i.comboId === comboId).map((i) => lineKey(i))
    setExcluded((prev) => {
      const next = new Set(prev)
      const semuaTercentang = keys.every((k) => !next.has(k))
      for (const k of keys) {
        if (semuaTercentang) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  // Ubah jumlah paket. Isi per paket diambil dari definisi paket di database; tanpa itu (belum
  // termuat) jumlahnya tak diubah — menebak isi paket bisa menghasilkan paket yang ditolak server.
  function setComboCount(comboId: string, count: number) {
    const def = combos?.find((c) => c.id === comboId)
    if (!def || count < 1) return
    setComboCountInCart(comboId, def.items, count)
  }

  // Keluarkan seluruh paket (anggotanya tak bisa dihapus satu per satu).
  function removeCombo(comboId: string) {
    const anggota = cookieCart.filter((i) => i.comboId === comboId).length
    const setuju =
      anggota <= 1 || window.confirm(`Keluarkan paket ini (${anggota} produk) dari keranjang?`)
    if (setuju) removeComboFromCart(comboId)
  }

  // Aksi baris di bawah ini hanya untuk baris SATUAN — anggota paket diatur lewat aksi paket di atas.
  function looseLine(productId: string, variantId?: string) {
    return cookieCart.find(
      (i) => !i.comboId && i.productId === productId && (i.variantId || undefined) === variantId,
    )
  }

  function increment(productId: string, variantId?: string) {
    const item = looseLine(productId, variantId)
    if (item) updateQuantity(productId, item.quantity + 1, variantId)
  }

  // Minimum pembelian baris tertentu (dari data produk hasil resolve). Default 1 = bebas.
  function minQtyOf(productId: string, variantId?: string): number {
    const line = items.find(
      (i) => !i.comboId && i.productId === productId && (i.variantId || undefined) === variantId,
    )
    return line && line.minOrderQty > 1 ? line.minOrderQty : 1
  }

  function decrement(productId: string, variantId?: string) {
    const item = looseLine(productId, variantId)
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

  // Menghapus satu baris SATUAN. Paket dikeluarkan utuh lewat removeCombo: sisa anggota paket
  // yang tertinggal akan tetap menampilkan harga paket padahal isinya tak lagi cocok dengan
  // database, dan server menolaknya.
  function remove(productId: string, variantId?: string) {
    removeFromCart(productId, variantId)
  }

  // Lanjut ke checkout: simpan item TERCENTANG + snapshot promo/combo yang tercapai.
  function handleCheckout() {
    // Guard: jangan lanjut bila subtotal barang belum mencapai minimum (tombol juga sudah
    // disabled; ini menutup jalur pemanggilan lain).
    if (selectedTotal < minOrderAmount) return
    // comboId IKUT DIBAWA (SEC-033). Dulu field ini dibuang di sini, sehingga /checkout dan
    // akhirnya /api/orders/create tak pernah tahu sebuah item bagian dari paket — server lalu
    // menagih harga satuan padahal layar menampilkan harga paket. Nilainya bukan harga dan tidak
    // dipercaya sebagai harga; server memakainya hanya untuk mencari paketnya di DB.
    //
    // Diambil PER BARIS, bukan lewat peta productId → comboId seperti dulu: dengan peta itu A
    // satuan yang berdampingan dengan A di dalam paket ikut terkirim sebagai anggota paket.
    const chosen = selectedItems.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
      variantId: i.variantId,
      variantName: i.variantName,
      comboId: i.comboId,
    }))
    setCheckoutItems(chosen)

    // Snapshot promo/combo agar bisa diteruskan ke order nanti
    const comboIds = Array.from(
      new Set(selectedItems.flatMap((i) => (i.comboId ? [i.comboId] : []))),
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
                {entries.map((entry) =>
                  entry.kind === 'combo' ? (
                    <CartComboGroup
                      key={`combo::${entry.group.comboId}`}
                      group={entry.group}
                      onToggleSelect={toggleSelectCombo}
                      onSetCount={setComboCount}
                      onRemove={removeCombo}
                    />
                  ) : (
                    <CartItemRow
                      key={lineKey(entry.item)}
                      item={entry.item}
                      onToggleSelect={toggleSelect}
                      onIncrement={increment}
                      onDecrement={decrement}
                      onSetQuantity={setQuantity}
                      onRemove={remove}
                    />
                  ),
                )}
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
        discount={orderPromos.discount}
        freeShipping={orderPromos.appliedPromos.some((p) => p.type === 'free_shipping')}
        minOrderAmount={minOrderAmount}
        stockBlocked={adaStokKurang || adaPaketRusak}
        onToggleSelectAll={toggleSelectAll}
        onCheckout={handleCheckout}
      />
    </div>
  )
}
