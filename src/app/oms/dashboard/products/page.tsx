'use client'

// src/app/oms/dashboard/products/page.tsx
// Halaman Manajemen Produk & Inventaris OMS — area internal Infarm.
// Menampilkan ringkasan stok + tabel produk dengan filter, seleksi massal, dan aksi per produk.
// SUMBER DATA TUNGGAL: /api/products/list (Supabase). Tak ada lagi produk contoh hardcode —
// setiap baris di tabel ini benar-benar ada di database, jadi semua aksi (edit, arsip, hapus,
// aksi massal) selalu tersimpan.
//
// FILTER: state disimpan di URL query params (pola sama dengan halaman Pesanan) agar bisa
// di-bookmark & di-share, tapi PENYARINGANNYA di client atas data yang sudah dimuat —
// /api/products/list juga dipakai storefront, jadi endpoint itu sengaja tidak disentuh.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import OmsHeader from '@/components/oms/OmsHeader'
import VariantManagerModal from '@/components/oms/VariantManagerModal'
import ProductImagePreview from '@/components/oms/ProductImagePreview'
import { PRODUCT_CATEGORIES, getCategoryLabel } from '@/lib/data/categories'
import {
  validateName,
  validateSkuFormat,
  validateCategory,
  validatePrice,
  validateOriginalPrice,
  validateMinOrderQty,
  validateBerat,
  validateDescription,
  validateImages,
  validateImageFile,
  isLowPrice,
  suggestMinOrderQty,
  LOW_PRICE_THRESHOLD,
  DEFAULT_LOW_STOCK_THRESHOLD,
  ACCEPTED_IMAGE_ACCEPT,
  NAME_MAX,
  DESC_MAX,
} from '@/lib/product-validation'
import { WEIGHT_GRAM_MIN, formatWeight, isWeightUnset } from '@/lib/shipping-weight'
import type { ProductCategory, StoredProduct } from '@/types/product'

// === Tipe Data ===

type Product = {
  id: string
  name: string
  sku: string
  categoryLabel: string // label tampilan kategori
  slug: ProductCategory | '' // slug kategori (untuk form edit)
  price: number // harga jual (promoPrice)
  originalPrice?: number // harga asli (dicoret bila > price)
  stock: number
  minOrderQty: number // minimum pembelian per baris keranjang (1 = bebas)
  berat?: number // berat satuan (GRAM); undefined = belum diisi admin → badge peringatan
  description?: string // deskripsi produk (tampil di halaman detail ecommerce)
  image: string // foto utama (thumbnail tabel) = images[0]
  images?: string[] // galeri foto (maks 9)
  archived: boolean // true = disembunyikan dari ecommerce, tetap ada di OMS
  createdAt?: string // ISO date dari DB; bila kosong, baris tersaring keluar saat filter tanggal aktif
}

// Bentuk data form pada modal edit
type EditForm = {
  name: string
  sku: string
  slug: ProductCategory | ''
  price: number | ''
  originalPrice: number | '' // harga asli (opsional)
  stock: number | ''
  minOrderQty: number | '' // minimum pembelian (pcs)
  berat: number | '' // berat satuan (gram) — dasar perhitungan ongkir
  description: string // deskripsi produk
  images: string[] // galeri foto (maks 9); images[0] = foto utama
}

// Ambang "stok menipis" diatur admin di /oms/dashboard/pengaturan (store_settings) dan diambil
// lewat GET /api/settings/low-stock-threshold. DEFAULT_LOW_STOCK_THRESHOLD hanya nilai awal
// sebelum hasil fetch tiba — angka final dipakai bersama widget "Stok Rendah" di Dashboard supaya
// jumlah peringatan di kedua halaman selalu cocok.
const MAX_IMAGES = 9 // maksimal foto per produk (sesuai slider detail produk)
const PAGE_SIZE = 10 // baris per halaman (sama dengan halaman Pesanan)

// Opsi filter status stok. Ambang batasnya mengikuti setelan admin agar konsisten dengan
// kartu ringkasan "Stok Menipis" di atas tabel.
const STOCK_FILTERS = [
  { value: 'habis', label: 'Stok Habis' },
  { value: 'menipis', label: 'Stok Menipis' },
  { value: 'tersedia', label: 'Tersedia' },
] as const
type StockFilter = (typeof STOCK_FILTERS)[number]['value']

const STATUS_FILTERS = [
  { value: 'aktif', label: 'Aktif' },
  { value: 'arsip', label: 'Diarsipkan' },
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

// Kelas bersama untuk SEMUA field di bilah filter (input teks, tanggal, dan select).
// Satu konstanta supaya keenam field tak pernah berbeda warna/ukuran sendiri-sendiri.
//
// `text-gray-900` + `placeholder:text-gray-700` WAJIB eksplisit: tanpa itu field mewarisi warna
// teks pemiliknya dan placeholder memakai default browser yang sangat terang, sehingga isi filter
// nyaris tak terbaca di atas kartu putih. Pola sama dengan filter di halaman Pesanan.
const FILTER_FIELD_CLASS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-700 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'

// Label di atas tiap field filter.
const FILTER_LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-gray-800'

// Ringkasan varian per produk (dari /api/variants/summary) — untuk tampilan harga & stok agregat.
type VariantSummary = { count: number; totalStock: number; minPrice: number; maxPrice: number }

// Pilihan rentang waktu untuk kolom "Terjual". days=null berarti sepanjang waktu.
const SALES_RANGES: { label: string; days: number | null }[] = [
  { label: '7 Hari', days: 7 },
  { label: '30 Hari', days: 30 },
  { label: '90 Hari', days: 90 },
  { label: 'Semua', days: null },
]

// Catatan: dulu di sini ada INITIAL_PRODUCTS — 5 produk contoh (PRD-001…005) yang dirender
// bersama produk asli. DIHAPUS karena barisnya tak ada di database: aksi massal, arsip, dan stok
// atasnya tak bisa menyimpan apa pun, sehingga tabel menampilkan angka yang tak bisa dipercaya.
// Tabel sekarang MURNI produk dari Supabase.

// Memetakan produk mock DB → view model tabel
function mapStored(p: StoredProduct): Product {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    categoryLabel: getCategoryLabel(p.category) ?? p.category,
    slug: p.category,
    price: p.promoPrice,
    originalPrice: p.originalPrice,
    stock: p.stock,
    minOrderQty: p.minOrderQty ?? 1,
    berat: p.berat,
    description: p.description,
    image: p.imageUrl,
    images: p.images,
    archived: p.archived ?? false,
    createdAt: p.createdAt,
  }
}

// Format angka ke Rupiah
function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value)
}

// Wrapper: useSearchParams (dipakai ProductsContent) WAJIB dibungkus <Suspense>, kalau tidak
// build Next.js gagal. Pola sama dengan halaman Pesanan.
export default function ProductsPage() {
  return (
    <Suspense fallback={<OmsHeader title="Produk" />}>
      <ProductsContent />
    </Suspense>
  )
}

function ProductsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // === Filter (sumber kebenaran = URL query params) ===
  const dari = searchParams.get('dari') ?? ''
  const sampai = searchParams.get('sampai') ?? ''
  const kategori = searchParams.get('kategori') ?? ''
  const stok = (searchParams.get('stok') as StockFilter | null) ?? ''
  const status = (searchParams.get('status') as StatusFilter | null) ?? ''
  const q = searchParams.get('q') ?? ''

  // Input pencarian punya state sendiri supaya mengetik terasa instan; URL baru diperbarui
  // setelah user berhenti mengetik (debounce), agar tak menumpuk entri history.
  const [searchInput, setSearchInput] = useState(q)
  const searchTimer = useRef<number | null>(null)

  // Paginasi (client-side, atas hasil filter)
  const [page, setPage] = useState(1)

  // Seleksi massal — berisi id produk yang dicentang di halaman aktif
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState<'delete' | null>(null)
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)

  // Menu ⋮ per baris yang sedang terbuka (id produk)
  const [rowMenu, setRowMenu] = useState<string | null>(null)

  // === State ===
  const [products, setProducts] = useState<Product[]>([])

  // Modal Edit
  const [editTarget, setEditTarget] = useState<Product | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  // Catatan: modal edit TIDAK lagi menyimpan stok. Stok hanya bisa diubah di
  // Gudang → Kelola Stok (satu tempat, tercatat di riwayat mutasi), jadi tak ada state stok di sini.
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Modal Hapus
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Modal Kelola Varian + ringkasan varian per produk
  const [variantTarget, setVariantTarget] = useState<Product | null>(null)
  const [summaries, setSummaries] = useState<Record<string, VariantSummary>>({})

  // Muat ringkasan varian (dipanggil saat mount & setiap kali varian berubah)
  const loadSummaries = useCallback(() => {
    fetch('/api/variants/summary')
      .then((res) => res.json())
      .then((data: { summaries?: Record<string, VariantSummary> }) => setSummaries(data.summaries ?? {}))
      .catch(() => {})
  }, [])
  useEffect(() => loadSummaries(), [loadSummaries])

  // Ambang "stok menipis" dari setelan admin (store_settings). Nilai awal = konstanta bawaan
  // supaya tabel tetap punya angka yang masuk akal pada render pertama, sebelum fetch selesai.
  const [lowStockThreshold, setLowStockThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD)
  useEffect(() => {
    let active = true
    fetch('/api/settings/low-stock-threshold', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { lowStockThreshold?: number } | null) => {
        if (active && typeof data?.lowStockThreshold === 'number') {
          setLowStockThreshold(data.lowStockThreshold)
        }
      })
      .catch(() => {
        // Gagal memuat setelan → tetap pakai nilai bawaan; peringatan stok tak boleh ikut mati.
      })
    return () => {
      active = false
    }
  }, [])

  // Data terjual per produk (peta productId → unit terjual) + rentang waktu terpilih
  const [soldCounts, setSoldCounts] = useState<Record<string, number>>({})
  const [rangeDays, setRangeDays] = useState<number | null>(30) // default 30 hari terakhir

  // SKU duplikat (mode edit) + toast sukses
  const [editSkuDuplicate, setEditSkuDuplicate] = useState(false)
  const [toast, setToast] = useState('')

  // Toast sukses setelah upload produk baru (flag di-set halaman upload sebelum redirect).
  // setToast dijalankan lewat timer 0ms, BUKAN langsung di badan efek: lint
  // `react-hooks/set-state-in-effect` melarang setState sinkron di dalam efek, dan toast ini
  // memang notifikasi sesudah render — bukan state yang dibutuhkan saat render pertama.
  useEffect(() => {
    let timer: number | undefined
    try {
      if (sessionStorage.getItem('oms_product_saved')) {
        sessionStorage.removeItem('oms_product_saved')
        timer = window.setTimeout(() => setToast('Produk berhasil disimpan.'), 0)
      }
    } catch {
      // sessionStorage bisa gagal (mode privat) — abaikan
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  // Auto-sembunyikan toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Ambil produk dari database (satu-satunya sumber tabel ini)
  useEffect(() => {
    let active = true
    fetch('/api/products/list')
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => {
        if (!active) return
        setProducts((data.products ?? []).map(mapStored))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Ambil jumlah terjual per produk sesuai rentang waktu terpilih
  useEffect(() => {
    let active = true
    const params = new URLSearchParams()
    // days=null → sepanjang waktu (tanpa filter from)
    if (rangeDays != null) {
      const from = new Date(Date.now() - rangeDays * 86_400_000).toISOString()
      params.set('from', from)
    }
    fetch(`/api/products/sales-count?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { counts?: Record<string, number> }) => {
        if (!active) return
        setSoldCounts(data.counts ?? {})
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [rangeDays])

  // === Filter: sinkronisasi URL ===

  // Memperbarui sebagian filter di URL. Nilai kosong/null menghapus param-nya.
  // router.replace dipakai (bukan push) supaya menyaring tidak menumpuk riwayat back button.
  const updateFilters = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') params.delete(key)
        else params.set(key, value)
      }
      const query = params.toString()
      router.replace(`/oms/dashboard/products${query ? `?${query}` : ''}`, { scroll: false })
      setPage(1)
      setSelected(new Set()) // hasil berubah → seleksi lama tak lagi relevan
    },
    [router, searchParams],
  )

  // Debounce dilakukan DI EVENT HANDLER, bukan lewat useEffect: menulis URL berarti memanggil
  // setState (page & seleksi ikut di-reset), dan lint `react-hooks/set-state-in-effect` melarang
  // setState sinkron di dalam efek.
  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => updateFilters({ q: value || null }), 400)
  }

  // Bersihkan timer bila komponen dilepas sebelum jeda selesai (tak ada setState di sini)
  useEffect(
    () => () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
    },
    [],
  )

  const hasActiveFilters = Boolean(dari || sampai || kategori || stok || status || q)

  function resetFilters() {
    setSearchInput('')
    router.replace('/oms/dashboard/products', { scroll: false })
    setPage(1)
    setSelected(new Set())
  }

  // Pintasan rentang tanggal (hari ini, 7/30 hari terakhir, bulan ini) — pola halaman Pesanan.
  function applyDateShortcut(days: number, monthStart = false) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(today)
    if (monthStart) from.setDate(1)
    else from.setDate(today.getDate() - days)
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    updateFilters({ dari: fmt(from), sampai: fmt(today) })
  }

  // === Filter: penyaringan ===

  // Stok efektif satu produk (produk bervarian → total stok varian, seperti kolom Sisa Stok).
  const stockOf = useCallback(
    (p: Product) => summaries[p.id]?.totalStock ?? p.stock,
    [summaries],
  )

  // Apakah satu produk cocok dengan sebuah status stok. Dipakai bersama oleh filter tabel DAN
  // hitungan kartu ringkasan, supaya angka di kartu tak mungkin berbeda dari jumlah baris yang
  // muncul saat kartu itu diklik.
  const matchesStock = useCallback(
    (p: Product, value: StockFilter) => {
      const s = stockOf(p)
      if (value === 'habis') return s === 0
      if (value === 'menipis') return s > 0 && s < lowStockThreshold
      return s >= lowStockThreshold // 'tersedia'
    },
    [stockOf, lowStockThreshold],
  )

  // Jumlah produk (aktif, bukan yang diarsipkan) yang beratnya belum diisi → dasar banner
  // pengingat. Produk diarsipkan dikecualikan: ia tak bisa dibeli, jadi beratnya tak memengaruhi
  // ongkir siapa pun dan hanya akan membuat angka pengingat terlihat lebih besar dari kenyataan.
  const missingWeightCount = useMemo(
    () => products.filter((p) => !p.archived && isWeightUnset(p.berat)).length,
    [products],
  )

  // Hasil SEMUA filter KECUALI status stok.
  //
  // Dipisah karena kartu ringkasan menghitung di atas basis ini: angka "Stok Menipis" harus
  // menggambarkan berapa hasil yang akan muncul bila kartunya diklik — yaitu dalam cakupan
  // kategori/tanggal/pencarian yang sedang aktif, tapi TANPA ikut menyaring status stok
  // (kalau ikut, mengklik satu kartu akan membuat angka kartu lain jadi 0).
  const filteredExceptStock = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    // Tanggal dibandingkan sebagai teks 'YYYY-MM-DD' (ISO), bukan objek Date — createdAt dari
    // Supabase sudah ISO sehingga perbandingan leksikografisnya setara perbandingan waktu.
    const fromDay = dari || null
    const toDay = sampai || null

    return products.filter((p) => {
      if (keyword && !`${p.name} ${p.sku}`.toLowerCase().includes(keyword)) return false
      if (kategori && p.slug !== kategori) return false
      if (status === 'aktif' && p.archived) return false
      if (status === 'arsip' && !p.archived) return false

      if (fromDay || toDay) {
        // Baris tanpa createdAt (mis. kolom belum terisi di DB lama) disaring keluar saat filter
        // tanggal aktif — mengklaim tanggal apa pun untuknya akan menyesatkan.
        if (!p.createdAt) return false
        const day = p.createdAt.slice(0, 10)
        if (fromDay && day < fromDay) return false
        if (toDay && day > toDay) return false
      }

      return true
    })
  }, [products, q, kategori, status, dari, sampai])

  // Hasil akhir tabel = basis di atas + filter status stok. AND antar semua jenis filter.
  const filtered = useMemo(
    () => (stok ? filteredExceptStock.filter((p) => matchesStock(p, stok)) : filteredExceptStock),
    [filteredExceptStock, stok, matchesStock],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageProducts = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // === Seleksi massal ===

  // Seluruh baris berasal dari database, jadi semuanya bisa dipilih.
  const selectableOnPage = pageProducts
  const allOnPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((p) => selected.has(p.id))
  const selectedCount = selected.size

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // "Pilih semua" berlaku untuk baris di HALAMAN AKTIF saja (bukan seluruh hasil filter),
  // supaya jumlah yang terpilih selalu sama dengan yang terlihat di layar.
  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) selectableOnPage.forEach((p) => next.delete(p.id))
      else selectableOnPage.forEach((p) => next.add(p.id))
      return next
    })
  }

  // Menjalankan aksi massal ke API lalu memperbarui daftar di layar.
  async function runBulk(action: 'archive' | 'restore' | 'delete' | 'category', category?: string) {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, category }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; affected?: number }
      if (!res.ok) {
        setToast(data.error ?? 'Aksi massal gagal.')
        return
      }

      // Perbarui state lokal sesuai aksi (hindari refetch penuh agar filter & halaman tak reset)
      const idSet = new Set(ids)
      if (action === 'delete') {
        setProducts((prev) => prev.filter((p) => !idSet.has(p.id)))
      } else if (action === 'archive' || action === 'restore') {
        const archived = action === 'archive'
        setProducts((prev) => prev.map((p) => (idSet.has(p.id) ? { ...p, archived } : p)))
      } else if (category) {
        const label = getCategoryLabel(category as ProductCategory) ?? category
        setProducts((prev) =>
          prev.map((p) =>
            idSet.has(p.id) ? { ...p, slug: category as ProductCategory, categoryLabel: label } : p,
          ),
        )
      }

      const verb =
        action === 'delete'
          ? 'dihapus'
          : action === 'archive'
            ? 'diarsipkan'
            : action === 'restore'
              ? 'dipulihkan'
              : 'diubah kategorinya'
      setToast(`${data.affected ?? ids.length} produk ${verb}.`)
      setSelected(new Set())
    } catch {
      setToast('Aksi massal gagal. Periksa koneksi lalu coba lagi.')
    } finally {
      setBulkBusy(false)
      setBulkConfirm(null)
      setBulkCategoryOpen(false)
    }
  }

  // === Ringkasan stok (sekaligus pintasan filter) ===
  //
  // Dihitung dari `filteredExceptStock`, BUKAN dari seluruh `products`: angka kartu harus sama
  // dengan jumlah baris yang muncul saat kartu itu diklik, termasuk ketika filter kategori/
  // tanggal/pencarian sedang aktif.
  //
  // Memakai `matchesStock` (yang membaca stok efektif lewat `stockOf`), BUKAN `p.stock` mentah.
  // Sebelumnya kartu memakai `p.stock` sementara tabel memakai `stockOf` — untuk produk bervarian
  // keduanya berbeda, sehingga angka kartu tak cocok dengan hasil filternya.
  const summary = useMemo(() => {
    let lowStock = 0
    let outOfStock = 0
    for (const p of filteredExceptStock) {
      if (matchesStock(p, 'habis')) outOfStock++
      else if (matchesStock(p, 'menipis')) lowStock++
    }
    return { total: filteredExceptStock.length, lowStock, outOfStock }
  }, [filteredExceptStock, matchesStock])

  // Klik kartu ringkasan = pintasan filter status stok.
  //
  // SATU sumber state dengan dropdown "Status Stok": keduanya menulis param `stok` lewat
  // `updateFilters`, yang menyalin seluruh param lain lebih dulu — jadi kategori/tanggal/
  // pencarian yang sedang aktif tak pernah ikut terhapus, dan tak ada state kedua yang perlu
  // disinkronkan (mustahil desinkron).
  //
  // Toggle: mengklik kartu yang SEDANG aktif melepas filternya. Untuk kartu "Total Produk"
  // (nilai '') kedua cabang sama-sama menghasilkan "tanpa filter", jadi mengkliknya berulang
  // aman — ia memang mewakili keadaan tak-terfilter.
  function toggleStockFilter(value: StockFilter | '') {
    updateFilters({ stok: stok === value ? null : value || null })
  }

  // === Aksi Edit ===

  function openEdit(product: Product) {
    setEditTarget(product)
    setEditError(null)
    setEditSkuDuplicate(false)
    // Galeri untuk diedit: pakai images bila ada, fallback ke foto utama tunggal
    const gallery =
      product.images && product.images.length > 0
        ? product.images
        : product.image
          ? [product.image]
          : []
    setForm({
      name: product.name,
      sku: product.sku,
      slug: product.slug,
      price: product.price,
      // Tampilkan harga asli hanya bila memang ada diskon (asli > jual); selain itu kosong
      originalPrice:
        product.originalPrice && product.originalPrice > product.price ? product.originalPrice : '',
      stock: product.stock,
      minOrderQty: product.minOrderQty ?? 1,
      // Berat kosong → input kosong (bukan diisi 1000): admin harus SADAR mengisinya, bukan
      // menyetujui angka cadangan tanpa melihatnya.
      berat: product.berat ?? '',
      description: product.description ?? '',
      images: gallery,
    })
  }

  function closeEdit() {
    setEditTarget(null)
    setForm(null)
    setEditError(null)
    setEditSkuDuplicate(false)
  }

  // Error live per field modal edit (dihitung dari form).
  // Stok TIDAK divalidasi di sini karena tidak bisa diubah dari modal ini.
  const editErrors = useMemo(() => {
    if (!form) return {} as Record<string, string | undefined>
    return {
      sku: validateSkuFormat(form.sku),
      name: validateName(form.name),
      category: validateCategory(form.slug),
      price: validatePrice(form.price),
      originalPrice: validateOriginalPrice(form.originalPrice, form.price),
      minOrderQty: validateMinOrderQty(form.minOrderQty),
      berat: validateBerat(form.berat),
      description: validateDescription(form.description),
      images: validateImages(form.images.length),
    }
  }, [form])

  // SKU error gabungan (format lalu duplikat) + status valid keseluruhan modal
  const editSkuError = editErrors.sku ?? (editSkuDuplicate ? 'SKU sudah digunakan produk lain' : undefined)
  const isEditValid =
    form != null &&
    !editSkuError &&
    !editErrors.name &&
    !editErrors.category &&
    !editErrors.price &&
    !editErrors.originalPrice &&
    !editErrors.minOrderQty &&
    !editErrors.berat &&
    !editErrors.description &&
    !editErrors.images

  // Cek duplikat SKU saat onBlur (kecualikan produk yang sedang diedit)
  async function checkEditSku() {
    if (!form || !editTarget) return
    if (validateSkuFormat(form.sku)) {
      setEditSkuDuplicate(false)
      return
    }
    try {
      const res = await fetch(
        `/api/products/check-sku?sku=${encodeURIComponent(form.sku.trim())}&excludeId=${encodeURIComponent(editTarget.id)}`,
      )
      const data = (await res.json()) as { exists?: boolean }
      setEditSkuDuplicate(data.exists === true)
    } catch {
      setEditSkuDuplicate(false)
    }
  }

  // Menambahkan satu/lebih foto ke galeri (data URL), dibatasi maks 9
  function handleEditImage(fileList: FileList | null) {
    if (!fileList || !form) return
    const available = MAX_IMAGES - form.images.length
    if (available <= 0) {
      setEditError(`Maksimal ${MAX_IMAGES} foto.`)
      return
    }
    // Ambil sebanyak slot tersisa; sisanya diabaikan
    Array.from(fileList)
      .slice(0, available)
      .forEach((file) => {
        const fileError = validateImageFile(file)
        if (fileError) {
          setEditError(fileError)
          return
        }
        setEditError(null)
        const reader = new FileReader()
        reader.onload = () =>
          setForm((f) =>
            f
              ? f.images.length >= MAX_IMAGES
                ? f
                : { ...f, images: [...f.images, reader.result as string] }
              : f,
          )
        reader.readAsDataURL(file)
      })
  }

  // Menghapus satu foto dari galeri berdasarkan indeks
  function removeEditImage(index: number) {
    setForm((f) => (f ? { ...f, images: f.images.filter((_, i) => i !== index) } : f))
  }

  async function handleSaveEdit() {
    if (!editTarget || !form) return

    // Validasi seluruh field (pesan spesifik dari validator bersama)
    const firstError =
      editSkuError ??
      editErrors.name ??
      editErrors.category ??
      editErrors.price ??
      editErrors.originalPrice ??
      editErrors.description ??
      editErrors.images
    if (firstError) {
      setEditError(firstError)
      return
    }

    setSaving(true)
    const price = Number(form.price) || 0
    const originalPrice = form.originalPrice === '' ? undefined : Number(form.originalPrice)

    try {
      const res = await fetch('/api/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget.id,
          name: form.name.trim(),
          sku: form.sku.trim(),
          category: form.slug,
          price,
          originalPrice,
          // stock & stockPerWarehouse SENGAJA tidak dikirim: modal ini tak boleh mengubah stok
          // (satu-satunya jalur = POST /api/warehouses/stock/set dari halaman Kelola Stok).
          // Tanpa field itu, /api/products/update membiarkan stok apa adanya.
          minOrderQty: Number(form.minOrderQty) || 1,
          berat: Number(form.berat),
          description: form.description.trim(),
          imageUrl: form.images[0],
          images: form.images,
        }),
      })
      if (!res.ok) throw new Error()
      const { product } = (await res.json()) as { product: StoredProduct }
      const mapped = mapStored(product)
      setProducts((prev) => prev.map((p) => (p.id === mapped.id ? mapped : p)))
    } catch {
      setEditError('Gagal menyimpan perubahan. Coba lagi.')
      setSaving(false)
      return
    }

    setSaving(false)
    setToast('Perubahan produk tersimpan.')
    closeEdit()
  }

  // === Aksi Hapus ===

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    try {
      await fetch('/api/products/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
    } catch {
      // Mode prototipe: tetap hapus dari layar walau API gagal
    }

    setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id))
    setDeleting(false)
    setDeleteTarget(null)
  }

  // === Aksi Arsip ===

  // Mengarsipkan / memulihkan produk. Diarsipkan = tetap di OMS, tapi hilang dari ecommerce.
  async function toggleArchive(product: Product) {
    const next = !product.archived

    try {
      await fetch('/api/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, archived: next }),
      })
    } catch {
      // Mode prototipe: tetap ubah status di layar walau API gagal
    }

    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, archived: next } : p)),
    )
  }

  return (
    <>
      <OmsHeader title="Produk" />
      <div className="p-6 md:p-8">
        {/* === Header Halaman === */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manajemen Produk &amp; Inventaris</h1>
            <p className="mt-1 text-sm text-gray-500">
              Kelola varian, harga, dan perbarui stok gudang aktif Infarm.
            </p>
          </div>
          <Link
            href="/oms/dashboard/products/upload"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            <PlusIcon />
            Tambah Produk Baru
          </Link>
        </header>

        {/* === Ringkasan Stok (klik = pintasan filter status stok) ===
            "Total Produk" aktif saat TIDAK ada filter stok. Memilih "Tersedia" dari dropdown
            sengaja membuat ketiganya netral — memang tak ada kartu yang mewakili keadaan itu,
            dan dropdown tetap menampilkannya dengan benar. */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Total Produk"
            value={`${summary.total} Item`}
            valueClass="text-gray-900"
            accentClass="bg-emerald-50 text-emerald-700"
            activeClass="border-emerald-500 bg-emerald-50/60 shadow-md"
            icon={<BoxIcon />}
            active={stok === ''}
            onClick={() => toggleStockFilter('')}
          />
          <SummaryCard
            label="Stok Menipis"
            value={`${summary.lowStock} Produk`}
            valueClass="text-amber-500"
            accentClass="bg-amber-50 text-amber-500"
            activeClass="border-amber-400 bg-amber-50/60 shadow-md"
            icon={<AlertIcon />}
            active={stok === 'menipis'}
            onClick={() => toggleStockFilter('menipis')}
          />
          <SummaryCard
            label="Stok Habis"
            value={`${summary.outOfStock} Produk`}
            valueClass="text-red-600"
            accentClass="bg-red-50 text-red-600"
            activeClass="border-red-500 bg-red-50/60 shadow-md"
            icon={<EmptyIcon />}
            active={stok === 'habis'}
            onClick={() => toggleStockFilter('habis')}
          />
        </section>

        {/* === Bilah Filter === */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {/* Pencarian nama / SKU */}
            <div className="lg:col-span-2">
              <label htmlFor="pf-q" className={FILTER_LABEL_CLASS}>
                Cari nama atau SKU
              </label>
              <input
                id="pf-q"
                type="search"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="mis. Cocopeat atau INF-CC-001"
                className={FILTER_FIELD_CLASS}
              />
            </div>

            {/* Kategori — opsi dari konstanta PRODUCT_CATEGORIES (satu sumber dengan storefront) */}
            <div>
              <label htmlFor="pf-kategori" className={FILTER_LABEL_CLASS}>
                Kategori
              </label>
              <select
                id="pf-kategori"
                value={kategori}
                onChange={(e) => updateFilters({ kategori: e.target.value || null })}
                className={FILTER_FIELD_CLASS}
              >
                <option value="">Semua kategori</option>
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status stok */}
            <div>
              <label htmlFor="pf-stok" className={FILTER_LABEL_CLASS}>
                Status stok
              </label>
              <select
                id="pf-stok"
                value={stok}
                onChange={(e) => updateFilters({ stok: e.target.value || null })}
                className={FILTER_FIELD_CLASS}
              >
                <option value="">Semua stok</option>
                {STOCK_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                    {f.value === 'menipis' ? ` (< ${lowStockThreshold})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Status produk */}
            <div>
              <label htmlFor="pf-status" className={FILTER_LABEL_CLASS}>
                Status produk
              </label>
              <select
                id="pf-status"
                value={status}
                onChange={(e) => updateFilters({ status: e.target.value || null })}
                className={FILTER_FIELD_CLASS}
              >
                <option value="">Semua status</option>
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Rentang tanggal dibuat — input date native (tanpa library) */}
            <div>
              <label htmlFor="pf-dari" className={FILTER_LABEL_CLASS}>
                Dibuat dari
              </label>
              <input
                id="pf-dari"
                type="date"
                value={dari}
                max={sampai || undefined}
                onChange={(e) => updateFilters({ dari: e.target.value || null })}
                className={FILTER_FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pf-sampai" className={FILTER_LABEL_CLASS}>
                Sampai
              </label>
              <input
                id="pf-sampai"
                type="date"
                value={sampai}
                min={dari || undefined}
                onChange={(e) => updateFilters({ sampai: e.target.value || null })}
                className={FILTER_FIELD_CLASS}
              />
            </div>
          </div>

          {/* Pintasan rentang tanggal */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-700">Pintasan:</span>
            {[
              { label: 'Hari ini', days: 0 },
              { label: '7 hari', days: 7 },
              { label: '30 hari', days: 30 },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applyDateShortcut(s.days)}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => applyDateShortcut(0, true)}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
            >
              Bulan ini
            </button>
          </div>

          {/* Chip filter aktif — tiap chip bisa dihapus sendiri */}
          {hasActiveFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              {q && (
                <FilterChip
                  label={`Cari: "${q}"`}
                  onRemove={() => {
                    setSearchInput('')
                    updateFilters({ q: null })
                  }}
                />
              )}
              {kategori && (
                <FilterChip
                  label={getCategoryLabel(kategori as ProductCategory) ?? kategori}
                  onRemove={() => updateFilters({ kategori: null })}
                />
              )}
              {stok && (
                <FilterChip
                  label={STOCK_FILTERS.find((f) => f.value === stok)?.label ?? stok}
                  onRemove={() => updateFilters({ stok: null })}
                />
              )}
              {status && (
                <FilterChip
                  label={STATUS_FILTERS.find((f) => f.value === status)?.label ?? status}
                  onRemove={() => updateFilters({ status: null })}
                />
              )}
              {dari && (
                <FilterChip label={`Dari ${dari}`} onRemove={() => updateFilters({ dari: null })} />
              )}
              {sampai && (
                <FilterChip
                  label={`Sampai ${sampai}`}
                  onRemove={() => updateFilters({ sampai: null })}
                />
              )}
              <button
                type="button"
                onClick={resetFilters}
                className="ml-1 text-xs font-semibold text-emerald-700 underline underline-offset-2 transition hover:text-emerald-800"
              >
                Reset semua filter
              </button>
            </div>
          )}
        </section>

        {/* === Filter Rentang Penjualan (kolom Terjual) === */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Terjual dalam:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {SALES_RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                onClick={() => setRangeDays(range.days)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  rangeDays === range.days
                    ? 'bg-emerald-700 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* === Bilah Aksi Massal (sticky di atas tabel, hanya saat ada yang dipilih) === */}
        {selectedCount > 0 && (
          <div className="sticky top-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
            <span className="text-sm font-semibold text-emerald-900">
              {selectedCount} produk dipilih
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('archive')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                <ArchiveIcon />
                Arsipkan Terpilih
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('restore')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                <RestoreIcon />
                Pulihkan Terpilih
              </button>
              <div className="relative">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setBulkCategoryOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                >
                  Ubah Kategori
                </button>
                {bulkCategoryOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {PRODUCT_CATEGORIES.map((c) => (
                      <button
                        key={c.slug}
                        type="button"
                        onClick={() => runBulk('category', c.slug)}
                        className="block w-full px-3 py-2 text-left text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setBulkConfirm('delete')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
              >
                <TrashIcon />
                Hapus Terpilih
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs font-semibold text-emerald-800 underline underline-offset-2"
              >
                Batalkan pilihan
              </button>
            </div>
          </div>
        )}

        {/* === Pengingat berat belum diisi ===
             Dihitung dari SELURUH produk (bukan hasil filter/halaman): admin perlu tahu total
             pekerjaan yang tersisa, bukan hanya yang kebetulan tampil di halaman ini. */}
        {missingWeightCount > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <ScaleIcon />
            <div className="text-xs leading-relaxed text-orange-800">
              <p className="font-semibold">
                {missingWeightCount} produk belum mengisi berat
              </p>
              <p className="mt-0.5">
                Ongkir produk tersebut sementara dihitung memakai berat cadangan{' '}
                <strong>1 kg per pcs</strong>, jadi tarif yang dilihat pembeli bisa jauh dari tarif
                kurir sebenarnya. Buka <strong>Edit</strong> pada baris ber-badge{' '}
                <span className="font-semibold">Belum diisi</span> dan isi berat aslinya.
              </p>
            </div>
          </div>
        )}

        {/* === Tabel Produk === */}
        <section className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Info jumlah hasil filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3 text-xs text-gray-500">
            <span>
              Menampilkan {pageProducts.length} dari {filtered.length} produk
              {hasActiveFilters ? ' (terfilter)' : ''}
            </span>
            {totalPages > 1 && (
              <span>
                Halaman {currentPage} dari {totalPages}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            {/* table-fixed + <colgroup>: lebar kolom ditentukan eksplisit, bukan diserahkan ke
                browser. Tanpa ini kolom Produk melebar mengikuti nama terpanjang dan mendorong
                kolom lain sampai tabel butuh scroll horizontal di layar normal. */}
            <table className="w-full min-w-[900px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-10" />
                <col className="w-[26%]" />
                <col className="w-28" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-20" />
                <col className="w-24" />
              </colgroup>
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-3.5">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAllOnPage}
                      disabled={selectableOnPage.length === 0}
                      aria-label="Pilih semua produk di halaman ini"
                      title="Pilih semua produk di halaman ini"
                      className="h-4 w-4 accent-emerald-700 disabled:opacity-40"
                    />
                  </th>
                  <th className="px-5 py-3.5">Produk</th>
                  <th className="px-3 py-3.5">SKU / Kode</th>
                  <th className="px-3 py-3.5">Kategori</th>
                  <th className="px-3 py-3.5">Harga</th>
                  <th className="px-3 py-3.5">Sisa Stok</th>
                  <th className="px-3 py-3.5">Terjual</th>
                  <th className="px-3 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageProducts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-gray-500">
                      Tidak ada produk yang cocok dengan filter.{' '}
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="font-semibold text-emerald-700 underline underline-offset-2"
                        >
                          Reset filter
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {pageProducts.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50/70 ${product.archived ? 'bg-gray-50/60' : ''} ${selected.has(product.id) ? 'bg-emerald-50/40' : ''}`}>
                    {/* Checkbox seleksi untuk aksi massal */}
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        aria-label={`Pilih ${product.name}`}
                        title={`Pilih ${product.name}`}
                        className="h-4 w-4 accent-emerald-700"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className={`flex items-center gap-3 ${product.archived ? 'opacity-60' : ''}`}>
                        <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                          <Image src={product.image} alt={product.name} fill unoptimized sizes="44px" className="object-cover" />
                        </div>
                        {/* min-w-0 wajib: tanpanya flex item menolak menyusut sehingga line-clamp
                            tak pernah aktif dan nama panjang mendorong lebar kolom. */}
                        <div className="min-w-0">
                          {/* Nama dipotong 2 baris; nama penuh lewat title (tooltip native) */}
                          <span
                            title={product.name}
                            className="line-clamp-2 font-medium text-gray-900"
                          >
                            {product.name}
                          </span>
                          {product.archived && (
                            <span className="mt-1 inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              Diarsipkan
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`px-3 py-4 font-mono text-xs text-gray-500 ${product.archived ? 'opacity-60' : ''}`}>
                      <span title={product.sku} className="block truncate">{product.sku}</span>
                    </td>
                    <td className={`px-3 py-4 ${product.archived ? 'opacity-60' : ''}`}>
                      <span
                        title={product.categoryLabel}
                        className="inline-flex max-w-full truncate rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                      >
                        {product.categoryLabel}
                      </span>
                    </td>
                    <td className={`px-3 py-4 text-gray-700 ${product.archived ? 'opacity-60' : ''}`}>
                      {summaries[product.id] ? (
                        // Produk bervarian → tampilkan rentang harga varian (bukan harga produk)
                        <span className="block truncate" title={`${summaries[product.id].count} varian`}>
                          {summaries[product.id].minPrice === summaries[product.id].maxPrice
                            ? formatRupiah(summaries[product.id].minPrice)
                            : `${formatRupiah(summaries[product.id].minPrice)} – ${formatRupiah(summaries[product.id].maxPrice)}`}
                          <span className="ml-1 text-xs text-emerald-600">({summaries[product.id].count} varian)</span>
                        </span>
                      ) : (
                        <span className="block truncate">{formatRupiah(product.price)}</span>
                      )}
                    </td>
                    {/* Berat TIDAK dikolomkan di sini: angka per baris tak membantu pekerjaan harian
                        admin (berat hanya relevan saat mengedit produk & saat ongkir dihitung).
                        Pengingat produk yang beratnya belum diisi tetap ada sebagai banner di atas
                        tabel — lihat missingWeightCount. */}
                    <td className="px-3 py-4">
                      {/* Arsip cepat untuk produk stok habis kini jadi ikon saja agar kolom tetap
                          sempit; labelnya lewat title. */}
                      <div className="flex items-center gap-1.5">
                        {/* Produk bervarian → total stok semua varian */}
                        <StockBadge
                          stock={summaries[product.id]?.totalStock ?? product.stock}
                          threshold={lowStockThreshold}
                        />
                        {product.stock === 0 && !product.archived && (
                          <button
                            type="button"
                            onClick={() => toggleArchive(product)}
                            aria-label={`Arsipkan ${product.name}`}
                            title="Arsipkan (stok habis)"
                            className="inline-flex items-center rounded-lg bg-amber-500 p-1.5 text-white transition hover:bg-amber-600"
                          >
                            <ArchiveIcon />
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Terjual dalam rentang waktu terpilih */}
                    <td className={`px-3 py-4 ${product.archived ? 'opacity-60' : ''}`}>
                      <span className="font-semibold text-gray-900">
                        {(soldCounts[product.id] ?? 0).toLocaleString('id-ID')}
                      </span>
                      <span className="ml-1 text-xs text-gray-400">pcs</span>
                    </td>
                    {/* Aksi: Edit & Varian sebagai ikon (paling sering dipakai), Arsip & Hapus
                        di dropdown ⋮ — Hapus yang destruktif jadi butuh satu klik ekstra. */}
                    <td className="px-3 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(product)}
                          aria-label={`Edit ${product.name}`}
                          title="Edit produk"
                          className="inline-flex items-center rounded-lg border border-emerald-200 bg-white p-2 text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <PencilIcon />
                        </button>
                        {/* Kelola varian */}
                        <button
                          type="button"
                          onClick={() => setVariantTarget(product)}
                          aria-label={`Kelola varian ${product.name}`}
                          title={`Kelola varian${summaries[product.id] ? ` (${summaries[product.id].count} varian)` : ''}`}
                          className="relative inline-flex items-center rounded-lg border border-emerald-200 bg-white p-2 text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <LayersIcon />
                          {summaries[product.id] && (
                            <span className="absolute -right-1 -top-1 rounded-full bg-emerald-700 px-1 text-[10px] font-bold leading-4 text-white">
                              {summaries[product.id].count}
                            </span>
                          )}
                        </button>

                        {/* Dropdown ⋮ — tutup lewat klik-luar (overlay transparan) */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setRowMenu(rowMenu === product.id ? null : product.id)}
                            aria-label={`Aksi lain untuk ${product.name}`}
                            aria-expanded={rowMenu === product.id}
                            title="Aksi lain"
                            className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 transition hover:bg-gray-50"
                          >
                            <DotsIcon />
                          </button>
                          {rowMenu === product.id && (
                            <>
                              <button
                                type="button"
                                aria-label="Tutup menu"
                                onClick={() => setRowMenu(null)}
                                className="fixed inset-0 z-20 cursor-default"
                              />
                              <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    toggleArchive(product)
                                    setRowMenu(null)
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                                >
                                  {product.archived ? <RestoreIcon /> : <ArchiveIcon />}
                                  {product.archived ? 'Pulihkan ke ecommerce' : 'Arsipkan'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteTarget(product)
                                    setRowMenu(null)
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                                >
                                  <TrashIcon />
                                  Hapus produk
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginasi (client-side atas hasil filter) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sebelumnya
              </button>
              <span className="text-xs text-gray-500">
                Halaman {currentPage} dari {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Berikutnya
              </button>
            </div>
          )}
        </section>
      </div>

      {/* === Konfirmasi Hapus Massal === */}
      {bulkConfirm === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Tutup konfirmasi"
            onClick={() => setBulkConfirm(null)}
            className="absolute inset-0 bg-gray-900/50"
          />
          <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900">
              Hapus {selectedCount} produk terpilih?
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              Produk beserta varian dan stok per gudangnya akan dihapus permanen dan{' '}
              <strong>tidak bisa dibatalkan</strong>. Riwayat pesanan lama tetap tersimpan. Kalau
              hanya ingin menyembunyikan dari ecommerce, gunakan Arsipkan.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => runBulk('delete')}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-60"
              >
                {bulkBusy ? 'Menghapus…' : 'Ya, Hapus Permanen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Modal Edit Produk === */}
      {editTarget && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Tutup modal" onClick={closeEdit} className="absolute inset-0 bg-gray-900/50" />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Edit Produk</h3>
            <p className="mt-1 text-sm text-gray-500">
              Perubahan disimpan permanen &amp; tampil di ecommerce.
            </p>

            {/* Galeri foto (maks 9). Foto pertama = foto utama. */}
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Foto Produk <span className="font-normal text-gray-400">(maks {MAX_IMAGES}, foto pertama = utama)</span>
              </label>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                {form.images.map((src, index) => (
                  <div
                    key={index}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                  >
                    {/* Klik thumbnail → preview ukuran penuh. Lihat ProductImagePreview:
                        state-nya lokal per sel supaya membuka preview tak me-render ulang tabel
                        produk di belakang modal ini. */}
                    <ProductImagePreview src={src} alt={`Foto ${index + 1}`} />
                    {/* Penanda foto utama. `pointer-events-none` supaya badge tak menghalangi klik
                        preview di pojok kiri atas thumbnail. */}
                    {index === 0 && (
                      <span className="pointer-events-none absolute left-1 top-1 z-10 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                        Utama
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeEditImage(index)}
                      aria-label={`Hapus foto ${index + 1}`}
                      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/60 text-xs leading-none text-white opacity-0 transition group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* Tombol tambah foto (muncul selama < 9 foto) */}
                {form.images.length < MAX_IMAGES && (
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition hover:border-emerald-400 hover:bg-emerald-50/40">
                    <span className="text-2xl leading-none">+</span>
                    <span className="mt-0.5 text-[10px] font-medium">Tambah</span>
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_ACCEPT}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleEditImage(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
              {editErrors.images && (
                <p className="mt-1 text-xs font-medium text-red-600">{editErrors.images}</p>
              )}
            </div>

            {/* Nama & SKU */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField label="Nama Produk">
                <input type="text" value={form.name} maxLength={NAME_MAX} onChange={(e) => setForm({ ...form, name: e.target.value })} className={modalInput(!!editErrors.name)} aria-invalid={!!editErrors.name} />
                {editErrors.name && <p className="mt-1 text-xs font-medium text-red-600">{editErrors.name}</p>}
              </EditField>
              <EditField label="SKU / Kode">
                <input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} onBlur={checkEditSku} className={modalInput(!!editSkuError)} aria-invalid={!!editSkuError} />
                {editSkuError && <p className="mt-1 text-xs font-medium text-red-600">{editSkuError}</p>}
              </EditField>
            </div>

            {/* Kategori */}
            <div className="mt-4">
              <EditField label="Kategori">
                <select value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value as ProductCategory })} className={modalInput(!!editErrors.category)} aria-invalid={!!editErrors.category}>
                  <option value="" disabled>Pilih kategori…</option>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.label}</option>
                  ))}
                </select>
                {editErrors.category && <p className="mt-1 text-xs font-medium text-red-600">{editErrors.category}</p>}
              </EditField>
            </div>

            {/* Harga & Stok */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField label="Harga Jual (Rp)">
                <input type="text" inputMode="numeric" value={form.price} onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setForm({ ...form, price: d === '' ? '' : Number(d) }) }} className={modalInput(!!editErrors.price)} aria-invalid={!!editErrors.price} />
                {editErrors.price && <p className="mt-1 text-xs font-medium text-red-600">{editErrors.price}</p>}
              </EditField>
              <EditField label="Harga Asli (opsional)">
                <input type="text" inputMode="numeric" value={form.originalPrice} onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setForm({ ...form, originalPrice: d === '' ? '' : Number(d) }) }} placeholder="Kosong = tanpa diskon" className={modalInput(!!editErrors.originalPrice)} aria-invalid={!!editErrors.originalPrice} />
                {editErrors.originalPrice && <p className="mt-1 text-xs font-medium text-red-600">{editErrors.originalPrice}</p>}
              </EditField>
              {/* Stok TIDAK bisa diubah dari sini. Satu-satunya tempat mengedit stok adalah
                  halaman Gudang → Kelola Stok, supaya setiap perubahan punya konteks gudang dan
                  tercatat di riwayat mutasi. Di sini hanya ringkasan read-only. */}
              <EditField label="Sisa Stok (pcs)">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs text-gray-500">
                      <LockIcon />
                      Total stok, semua gudang
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-800">
                      {form.stock === '' ? 0 : form.stock}
                    </p>
                  </div>
                  <Link
                    href={`/oms/dashboard/gudang/stok?search=${encodeURIComponent(form.sku.trim())}`}
                    className="flex-none whitespace-nowrap text-xs font-semibold text-emerald-700 transition hover:text-emerald-800 hover:underline"
                  >
                    Kelola stok gudang →
                  </Link>
                </div>
              </EditField>
              <EditField label="Minimal Pembelian (pcs)">
                <input type="text" inputMode="numeric" value={form.minOrderQty} onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setForm({ ...form, minOrderQty: d === '' ? '' : Number(d) }) }} placeholder="1" className={modalInput(!!editErrors.minOrderQty)} aria-invalid={!!editErrors.minOrderQty} />
                {editErrors.minOrderQty
                  ? <p className="mt-1 text-xs font-medium text-red-600">{editErrors.minOrderQty}</p>
                  : <p className="mt-1 text-xs text-gray-400">1 = pembeli boleh beli satuan.</p>}
              </EditField>
              {/* Berat — dasar perhitungan ongkir. Produk lama masih kosong sampai admin mengisinya. */}
              <EditField label="Berat (gram)">
                <input type="text" inputMode="numeric" value={form.berat} onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setForm({ ...form, berat: d === '' ? '' : Number(d) }) }} placeholder="Contoh: 500" className={modalInput(!!editErrors.berat)} aria-invalid={!!editErrors.berat} />
                {editErrors.berat
                  ? <p className="mt-1 text-xs font-medium text-red-600">{editErrors.berat}</p>
                  : <p className="mt-1 text-xs text-gray-400">
                      {typeof form.berat === 'number' && form.berat >= WEIGHT_GRAM_MIN
                        ? `Ongkir dihitung dari ${formatWeight(form.berat)} per pcs.`
                        : 'Berat 1 pcs. Dipakai menghitung ongkir.'}
                    </p>}
              </EditField>
            </div>

            {/* Peringatan harga kecil — non-blocking, sama dengan form tambah produk */}
            {isLowPrice(form.price) && !editErrors.price && (
              <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-700">
                Harga produk di bawah {formatRupiah(LOW_PRICE_THRESHOLD)} — disarankan set minimal
                pembelian{suggestMinOrderQty(form.price) ? ` (saran: ${suggestMinOrderQty(form.price)} pcs)` : ''} agar
                transaksi memenuhi minimum payment gateway.
              </p>
            )}

            {/* Deskripsi produk (tampil di halaman detail ecommerce) */}
            <div className="mt-4">
              <EditField label="Deskripsi Produk">
                <textarea
                  value={form.description}
                  maxLength={DESC_MAX}
                  rows={4}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={`${modalInput(!!editErrors.description)} resize-y`}
                  aria-invalid={!!editErrors.description}
                  placeholder="Jelaskan detail produk, manfaat, cara pakai, dll."
                />
                <div className="mt-1 flex items-center justify-between">
                  {editErrors.description ? (
                    <p className="text-xs font-medium text-red-600">{editErrors.description}</p>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-gray-400">{form.description.length}/{DESC_MAX}</span>
                </div>
              </EditField>
            </div>

            {editError && <p className="mt-3 text-xs font-medium text-red-600">{editError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={closeEdit} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                Batal
              </button>
              <button type="button" onClick={handleSaveEdit} disabled={saving || !isEditValid} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Modal Kelola Varian === */}
      {variantTarget && (
        <VariantManagerModal
          productId={variantTarget.id}
          productName={variantTarget.name}
          onClose={() => setVariantTarget(null)}
          onChanged={loadSummaries}
        />
      )}

      {/* === Toast sukses === */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2" role="status">
          <p className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}

      {/* === Modal Konfirmasi Hapus === */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Tutup modal" onClick={() => setDeleteTarget(null)} className="absolute inset-0 bg-gray-900/50" />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <TrashIcon />
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">Hapus Produk?</h3>
            <p className="mt-1 text-sm text-gray-500">
              Produk <span className="font-semibold text-gray-700">{deleteTarget.name}</span> akan dihapus
              permanen dan tidak lagi tampil di ecommerce.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                Batal
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                {deleting ? 'Menghapus…' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// === Sub-komponen ===

// Kelas input modal; border merah saat error
function modalInput(hasError = false): string {
  const base = 'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:ring-2'
  return hasError
    ? `${base} border-red-400 focus:border-red-500 focus:ring-red-100`
    : `${base} border-gray-300 focus:border-emerald-500 focus:ring-emerald-100`
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

// Kartu ringkasan stok — sekaligus PINTASAN filter (klik = terapkan/lepas filter status stok).
//
// Dirender sebagai <button>, bukan <div onClick>: supaya bisa difokus & ditekan lewat keyboard
// dan pembaca layar mengumumkannya sebagai kontrol. `aria-pressed` menyampaikan status aktifnya.
//
// Border SELALU 2px (`border-2`), yang berubah hanya WARNANYA saat aktif. Kalau ketebalannya
// yang diubah (1px → 2px), seluruh isi kartu bergeser 1px tiap kali filter di-toggle.
function SummaryCard({
  label,
  value,
  valueClass,
  accentClass,
  activeClass,
  icon,
  active,
  onClick,
}: {
  label: string
  value: string
  valueClass: string
  accentClass: string
  // Kelas border + latar saat kartu jadi filter aktif (warna mengikuti tema kartu).
  activeClass: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 p-5 text-left shadow-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 ${
        active
          ? activeClass
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
      }`}
    >
      <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${accentClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500">{label}</p>
        <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      </div>
    </button>
  )
}

// Badge sisa stok dengan indikator warna: hijau (aman), kuning (menipis), merah (habis)
function StockBadge({ stock, threshold }: { stock: number; threshold: number }) {
  if (stock === 0) {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">Habis (0)</span>
  }
  if (stock < threshold) {
    return <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">{stock} pcs</span>
  }
  return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{stock} pcs</span>
}

// === Ikon (inline SVG) ===

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

// Ikon gembok — penanda field read-only (stok, yang hanya bisa diubah di Gudang → Kelola Stok).
function LockIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// Ikon timbangan — penanda banner pengingat berat produk.
function ScaleIcon() {
  return (
    <svg className="mt-0.5 h-4 w-4 flex-none text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 7h14" />
      <path d="M5 7 2 13h6L5 7Z" />
      <path d="m19 7-3 6h6l-3-6Z" />
    </svg>
  )
}

// Ikon titik tiga vertikal — pemicu dropdown aksi lain per baris.
function DotsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

// Chip satu filter aktif + tombol hapus filter itu saja.
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-1 pl-2.5 pr-1 text-xs font-medium text-emerald-800">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Hapus filter ${label}`}
        className="rounded-full p-0.5 transition hover:bg-emerald-100"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

function LayersIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function EmptyIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}
