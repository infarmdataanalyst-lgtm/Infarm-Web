'use client'

// src/app/oms/dashboard/gudang/stok/page.tsx
// Halaman OMS "Kelola Stok Gudang" — matrix produk × gudang, SATU-SATUNYA tempat stok produk
// boleh diubah. Form produk hanya menampilkan total stok (read-only) + tautan ke sini.
//
// === MODE EDIT EKSPLISIT (bukan autosave) ===
// Versi pertama halaman ini menyimpan otomatis saat blur. Itu dibuang karena angka stok terlalu
// mahal untuk salah: satu ketikan tak sengaja langsung mengubah apa yang dilihat pembeli dan
// menentukan pesanan bisa masuk atau tidak. Alurnya sekarang berlapis, tiap lapis punya tujuan:
//   1. Baris read-only        → menyentuh tabel tidak mengubah apa pun
//   2. Tombol "Edit" per baris → niat mengubah harus dinyatakan; satu baris saja yang bisa dibuka
//   3. Indikator perubahan     → tiap sel yang berubah ditandai "lama → baru" + delta berwarna
//   4. Undo & Batal            → pulihkan sebelum menyimpan, tanpa perlu ingat angka aslinya
//   5. Dialog konfirmasi       → rekap seluruh perubahan baris itu sebelum benar-benar dikirim
//   6. Undo setelah simpan     → tulis balik nilai lama (compensating write, bukan hapus riwayat)
//
// === PERAN ===
// Menulis stok butuh peran 'admin' (kolom admin_users.role). Peran 'staff' melihat halaman ini
// tanpa tombol Edit. `canEdit` dari server hanya untuk TAMPILAN — penjagaan sebenarnya di
// POST /api/warehouses/stock/set (requireStockEditor).
//
// PRODUK BERVARIAN: stoknya tinggal di baris varian (product_stock_per_warehouse.variant_id terisi),
// jadi sel level-produk DIKUNCI dan baris dibuka (▸) untuk mengedit per varian. Tanpa ini,
// mengedit level produk akan membuat baris variant_id NULL yang berjalan paralel dengan stok varian
// dan membuat angkanya tak bisa dipercaya.

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  Info,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import GudangTabs from '@/components/oms/GudangTabs'
import { validateStock } from '@/lib/product-validation'

// === Tipe payload /api/warehouses/stock/matrix ===

type MatrixWarehouse = { id: string; nama: string; isDefault: boolean }

type MatrixVariant = {
  id: string
  name: string
  sku: string
  cells: Record<string, number>
  total: number
}

type MatrixProduct = {
  id: string
  name: string
  sku: string
  archived: boolean
  hasVariants: boolean
  cells: Record<string, number>
  total: number
  variants: MatrixVariant[]
}

// Satu sel yang diubah — dipakai draft, dialog konfirmasi, payload, dan undo.
type CellChange = {
  productId: string
  variantId?: string
  warehouseId: string
  stok: number
}

// Info untuk menawarkan undo setelah penyimpanan sukses.
type UndoOffer = { changes: CellChange[]; count: number; productName: string }

// Kunci sel di dalam satu baris produk: varian (atau 'p' untuk level produk) + gudang.
function cellKey(variantId: string | undefined, warehouseId: string): string {
  return `${variantId ?? 'p'}:${warehouseId}`
}

export default function KelolaStokPage() {
  // useSearchParams butuh Suspense boundary (tautan dari modal edit produk memakai ?search=<sku>).
  return (
    <Suspense fallback={<PageShell>{null}</PageShell>}>
      <KelolaStokContent />
    </Suspense>
  )
}

// Kerangka halaman dipakai bersama fallback Suspense agar header tak berkedip saat hidrasi.
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OmsHeader title="Kelola Stok Gudang" />
      <div className="p-4 sm:p-6">
        <GudangTabs />
        {children}
      </div>
    </>
  )
}

function KelolaStokContent() {
  const searchParams = useSearchParams()

  const [warehouses, setWarehouses] = useState<MatrixWarehouse[]>([])
  const [products, setProducts] = useState<MatrixProduct[]>([])
  const [mode, setMode] = useState<'single' | 'multi'>('multi')
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Filter & pencarian. Nilai awal pencarian dari ?search= (tautan "Kelola stok gudang →"
  // di modal edit produk mengirim SKU produk yang sedang dibuka).
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')

  // Baris produk bervarian yang sedang dibuka.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // === State mode edit ===
  // Hanya SATU baris boleh diedit sekaligus: menyimpan beberapa baris setengah-jadi adalah cara
  // paling mudah kehilangan perubahan tanpa sadar.
  const [editingId, setEditingId] = useState<string | null>(null)
  // Nilai draft sebagai TEKS (bukan number) supaya sel boleh kosong sementara saat diketik.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [toast, setToast] = useState('')
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null)
  const [undoing, setUndoing] = useState(false)

  // Pemuatan awal matrix.
  //
  // Fungsi load SENGAJA didefinisikan DI DALAM efek: lint react-hooks/set-state-in-effect menandai
  // efek yang memanggil fungsi luar yang mengandung setState. `loading` juga sudah true saat mount.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/warehouses/stock/matrix')
        const data = (await res.json().catch(() => ({}))) as {
          mode?: 'single' | 'multi'
          canEdit?: boolean
          warehouses?: MatrixWarehouse[]
          products?: MatrixProduct[]
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error ?? 'Gagal memuat data stok gudang.')
          return
        }
        setWarehouses(data.warehouses ?? [])
        setProducts(data.products ?? [])
        setMode(data.mode ?? 'multi')
        setCanEdit(data.canEdit === true)
        setLoadError('')
      } catch {
        if (!cancelled) setLoadError('Gagal memuat data stok gudang. Periksa koneksi lalu muat ulang.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Toast & tawaran undo hilang sendiri. 12 detik: cukup untuk menyadari "lho, salah angka",
  // tanpa membuat tombol berbahaya menetap di layar sepanjang sesi.
  useEffect(() => {
    if (!toast && !undoOffer) return
    const t = setTimeout(() => {
      setToast('')
      setUndoOffer(null)
    }, 12000)
    return () => clearTimeout(t)
  }, [toast, undoOffer])

  // Kolom gudang yang ditampilkan. Filter hanya MENYEMBUNYIKAN kolom — datanya tetap ada di state
  // dan kolom Total tetap menjumlahkan SEMUA gudang, supaya angkanya sama dengan kolom Stok di
  // halaman Produk dan dengan stok yang dilihat pembeli.
  const visibleWarehouses = useMemo(
    () => (warehouseFilter === 'all' ? warehouses : warehouses.filter((w) => w.id === warehouseFilter)),
    [warehouses, warehouseFilter],
  )

  // Pencarian client-side: jumlah produk masih 11 (jauh di bawah ~200), jadi tak ada gunanya
  // membebani server. Bila katalog melewati ~200 produk, pindahkan penyaringan + paginasi ke
  // /api/warehouses/stock/matrix — bentuk payload-nya sudah per produk sehingga UI tak berubah.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.variants.some((v) => v.name.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)),
    )
  }, [products, search])

  const editingProduct = useMemo(
    () => (editingId ? (products.find((p) => p.id === editingId) ?? null) : null),
    [editingId, products],
  )

  // Nilai tersimpan satu sel (sumber pembanding untuk menentukan "berubah" atau tidak).
  function savedValue(product: MatrixProduct, variantId: string | undefined, warehouseId: string): number {
    if (variantId) {
      return product.variants.find((v) => v.id === variantId)?.cells[warehouseId] ?? 0
    }
    return product.cells[warehouseId] ?? 0
  }

  // Daftar perubahan baris yang sedang diedit + validitasnya.
  // Dihitung ulang tiap render (bukan disimpan di state) supaya tak pernah basi terhadap draft.
  const editState = useMemo(() => {
    if (!editingProduct) return { changes: [] as CellChange[], hasEmpty: false, invalid: undefined as string | undefined }

    const changes: CellChange[] = []
    let hasEmpty = false
    let invalid: string | undefined

    for (const [key, text] of Object.entries(draft)) {
      const [variantPart, warehouseId] = key.split(':')
      const variantId = variantPart === 'p' ? undefined : variantPart
      // Gudang yang sedang disembunyikan filter tak pernah masuk draft, tapi jaga-jaga.
      if (!warehouseId) continue

      if (text.trim() === '') {
        hasEmpty = true
        continue
      }
      const next = Number(text)
      const message = validateStock(Number.isNaN(next) ? '' : next)
      if (message) {
        invalid ??= message
        continue
      }
      const before = savedValue(editingProduct, variantId, warehouseId)
      if (next !== before) {
        changes.push({
          productId: editingProduct.id,
          ...(variantId ? { variantId } : {}),
          warehouseId,
          stok: next,
        })
      }
    }

    return { changes, hasEmpty, invalid }
  }, [draft, editingProduct])

  // === Aksi mode edit ===

  function startEdit(product: MatrixProduct) {
    setEditingId(product.id)
    setSaveError('')
    setToast('')
    setUndoOffer(null)
    // Produk bervarian: buka barisnya otomatis — sel yang bisa diedit ada di sub-baris varian,
    // jadi membiarkannya tertutup akan tampak seperti "mode edit yang tak bisa diapa-apakan".
    if (product.hasVariants) {
      setExpanded((prev) => new Set(prev).add(product.id))
    }
    // Draft diisi seluruh sel baris (bukan hanya yang diubah) agar input punya nilai awal
    // dan perbandingan "lama vs baru" tak perlu menebak.
    const next: Record<string, string> = {}
    for (const w of warehouses) {
      if (product.hasVariants) {
        for (const v of product.variants) next[cellKey(v.id, w.id)] = String(v.cells[w.id] ?? 0)
      } else {
        next[cellKey(undefined, w.id)] = String(product.cells[w.id] ?? 0)
      }
    }
    setDraft(next)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
    setSaveError('')
    setConfirmOpen(false)
  }

  // Undo SEBELUM simpan: pulihkan seluruh sel baris ke nilai tersimpan.
  function undoDraft() {
    if (!editingProduct) return
    startEdit(editingProduct)
  }

  // Menulis sekumpulan perubahan ke server. Dipakai "Simpan" MAUPUN "Batalkan" (undo setelah
  // simpan) — keduanya operasi yang sama, hanya angkanya berbeda arah.
  async function pushChanges(changes: CellChange[]): Promise<{ previous?: CellChange[]; error?: string }> {
    try {
      const res = await fetch('/api/warehouses/stock/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      const data = (await res.json().catch(() => ({}))) as { previous?: CellChange[]; error?: string }
      if (!res.ok) return { error: data.error ?? 'Gagal menyimpan perubahan stok.' }
      return { previous: data.previous ?? [] }
    } catch {
      return { error: 'Gagal menyimpan. Periksa koneksi lalu coba lagi.' }
    }
  }

  // Menerapkan hasil penyimpanan ke state lokal (tanpa memuat ulang seluruh matrix).
  function applyChanges(changes: CellChange[]) {
    const activeIds = new Set(warehouses.map((w) => w.id))
    const sum = (cells: Record<string, number>) =>
      Object.entries(cells).reduce((t, [id, stok]) => (activeIds.has(id) ? t + stok : t), 0)

    setProducts((prev) =>
      prev.map((product) => {
        const mine = changes.filter((c) => c.productId === product.id)
        if (mine.length === 0) return product

        let next: MatrixProduct = { ...product, cells: { ...product.cells }, variants: product.variants.map((v) => ({ ...v, cells: { ...v.cells } })) }
        for (const change of mine) {
          if (change.variantId) {
            next.variants = next.variants.map((v) =>
              v.id === change.variantId
                ? { ...v, cells: { ...v.cells, [change.warehouseId]: change.stok } }
                : v,
            )
          } else {
            next.cells = { ...next.cells, [change.warehouseId]: change.stok }
          }
        }
        next.variants = next.variants.map((v) => ({ ...v, total: sum(v.cells) }))
        next = {
          ...next,
          total: next.variants.length > 0 ? next.variants.reduce((t, v) => t + v.total, 0) : sum(next.cells),
        }
        return next
      }),
    )
  }

  // Simpan setelah dikonfirmasi di dialog.
  async function handleConfirmSave() {
    if (!editingProduct || editState.changes.length === 0) return
    setSaving(true)
    setSaveError('')

    const { previous, error } = await pushChanges(editState.changes)
    setSaving(false)

    if (error) {
      setSaveError(error)
      setConfirmOpen(false)
      return
    }

    const count = editState.changes.length
    const productName = editingProduct.name
    applyChanges(editState.changes)
    setConfirmOpen(false)
    setEditingId(null)
    setDraft({})
    setToast(`${count} perubahan stok disimpan.`)
    // Nilai LAMA datang dari server (bukan dari state klien) supaya undo menulis balik angka yang
    // benar-benar tercatat sebelum perubahan.
    if (previous && previous.length > 0) setUndoOffer({ changes: previous, count, productName })
  }

  // Undo SETELAH simpan: menulis balik nilai lama. Ini compensating write — riwayat mutasi akan
  // memuat DUA baris (perubahan + pembatalannya), bukan menghapus jejak yang pertama.
  async function handleUndoSaved() {
    if (!undoOffer) return
    setUndoing(true)
    const { error } = await pushChanges(undoOffer.changes)
    setUndoing(false)
    if (error) {
      setSaveError(error)
      return
    }
    applyChanges(undoOffer.changes)
    setUndoOffer(null)
    setToast('Perubahan stok dibatalkan — nilai lama dipulihkan.')
  }

  function toggleExpanded(productId: string) {
    // Baris yang sedang diedit tidak boleh ditutup: sel input-nya ada di dalam sana.
    if (editingId === productId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const totalColumns = visibleWarehouses.length + 3 // Produk + kolom gudang + Total + Aksi

  return (
    <PageShell>
      {/* === Baris kontrol: filter gudang + pencarian === */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          aria-label="Filter gudang"
          disabled={editingId !== null}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:w-56"
        >
          <option value="all">Semua gudang</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.nama}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama produk atau SKU"
            disabled={editingId !== null}
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-700 placeholder-gray-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-gray-50"
          />
        </div>
      </div>

      {/* Peran staff: halaman tetap berguna untuk melihat stok, tapi tanpa jalan mengubahnya. */}
      {!loading && !canEdit && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-gray-500" />
          <p>
            Akun Anda berperan <strong>staff</strong> — stok hanya bisa dilihat. Untuk mengubah stok,
            gunakan akun berperan <strong>admin</strong>.
          </p>
        </div>
      )}

      {/* Filter gudang dikunci saat mengedit: mengubah kolom yang tampil di tengah pengeditan
          akan menyembunyikan sel yang sudah diubah tapi belum disimpan. */}
      {editingId !== null && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Pencil className="mt-0.5 h-4 w-4 flex-none" />
          <p>
            Sedang mengedit <strong>{editingProduct?.name}</strong>. Filter & pencarian dikunci sampai
            perubahan disimpan atau dibatalkan.
          </p>
        </div>
      )}

      {/* Mode single = tuas rollback: stok tetap tercatat per gudang, tapi pemenuhan pesanan
          selalu memakai gudang default. Perlu disebut agar admin tak bingung melihat beberapa kolom. */}
      {mode === 'single' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800">
          <Info className="mt-0.5 h-4 w-4 flex-none" />
          <p>
            Mode <strong>satu gudang</strong> sedang aktif. Stok tetap bisa diatur per gudang, tapi
            seluruh pesanan dipenuhi dari gudang default dan pembeli melihat TOTAL semua gudang.
          </p>
        </div>
      )}

      {(loadError || saveError) && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <p>{loadError || saveError}</p>
        </div>
      )}

      {/* === Tabel matrix === */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          {/* Lebar kolom eksplisit: tanpa table-fixed + colgroup, kolom Produk melebar mengikuti
              nama produk terpanjang dan mendorong kolom angka keluar layar. */}
          <colgroup>
            <col className="w-[280px]" />
            {visibleWarehouses.map((w) => (
              <col key={w.id} className="w-[150px]" />
            ))}
            <col className="w-[110px]" />
            <col className="w-[110px]" />
          </colgroup>

          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Produk</th>
              {visibleWarehouses.map((w) => (
                <th key={w.id} className="px-4 py-3 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate" title={w.nama}>
                      {w.nama}
                    </span>
                    {w.isDefault && (
                      <span className="flex-none rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold normal-case text-emerald-700">
                        Default
                      </span>
                    )}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 text-center font-semibold">Aksi</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={totalColumns} className="px-4 py-10 text-center text-gray-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={totalColumns} className="px-4 py-10 text-center text-sm text-gray-500">
                  {products.length === 0
                    ? 'Belum ada produk di database.'
                    : 'Tidak ada produk yang cocok dengan pencarian.'}
                </td>
              </tr>
            ) : (
              filtered.map((product) => {
                const isOpen = expanded.has(product.id)
                const isEditing = editingId === product.id
                const otherEditing = editingId !== null && !isEditing

                return (
                  // Fragment ber-key: satu produk merender 1 baris + N baris varian + 1 baris aksi.
                  <Fragment key={product.id}>
                    <tr
                      className={`align-middle ${
                        isEditing ? 'bg-amber-50/60' : otherEditing ? 'opacity-50' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      {/* Kolom produk: nama + SKU. Tombol ▸ hanya untuk produk bervarian. */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          {product.hasVariants ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(product.id)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? 'Sembunyikan varian' : 'Tampilkan varian'}
                              className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          ) : (
                            <span className="h-5 w-5 flex-none" />
                          )}
                          <div className="min-w-0">
                            <p className="line-clamp-2 font-medium text-gray-800" title={product.name}>
                              {product.name}
                            </p>
                            <p className="mt-0.5 font-mono text-xs text-gray-400">{product.sku}</p>
                            {product.hasVariants && (
                              <p className="mt-1 text-xs text-gray-500">
                                {product.variants.length} varian — stok diatur per varian
                              </p>
                            )}
                            {product.archived && (
                              <span className="mt-1 inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                                Diarsipkan
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {visibleWarehouses.map((w) => (
                        <td key={w.id} className="px-4 py-3">
                          {product.hasVariants ? (
                            // Sel dikunci: stok produk bervarian tinggal di baris varian.
                            <span
                              className="flex items-center gap-1.5 text-sm text-gray-400"
                              title="Stok produk bervarian diatur per varian — buka baris ini"
                            >
                              <Lock className="h-3.5 w-3.5" />
                              {product.variants.reduce((t, v) => t + (v.cells[w.id] ?? 0), 0)}
                            </span>
                          ) : isEditing ? (
                            <StockInput
                              value={draft[cellKey(undefined, w.id)] ?? ''}
                              saved={product.cells[w.id] ?? 0}
                              onChange={(text) =>
                                setDraft((prev) => ({ ...prev, [cellKey(undefined, w.id)]: text }))
                              }
                            />
                          ) : (
                            <span className="tabular-nums text-gray-800">{product.cells[w.id] ?? 0}</span>
                          )}
                        </td>
                      ))}

                      <td className="px-4 py-3 font-semibold tabular-nums text-gray-800">
                        {isEditing ? (
                          <PreviewTotal
                            product={product}
                            draft={draft}
                            warehouses={warehouses}
                            savedTotal={product.total}
                          />
                        ) : (
                          product.total
                        )}
                      </td>

                      {/* Kolom Aksi (dulu kolom Riwayat — riwayat kini lewat tautan di bawah tabel) */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <span className="text-xs font-semibold text-amber-700">Sedang diedit</span>
                        ) : canEdit ? (
                          <button
                            type="button"
                            onClick={() => startEdit(product)}
                            disabled={otherEditing}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-emerald-500 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                            title={otherEditing ? 'Selesaikan pengeditan baris lain dulu' : 'Ubah stok produk ini'}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Sub-baris varian (saat dibuka) */}
                    {isOpen &&
                      product.variants.map((variant) => (
                        <tr
                          key={variant.id}
                          className={`align-middle ${isEditing ? 'bg-amber-50/40' : otherEditing ? 'opacity-50' : 'bg-gray-50/50'}`}
                        >
                          <td className="px-4 py-2.5 pl-11">
                            <p className="truncate text-sm text-gray-700" title={variant.name}>
                              {variant.name}
                            </p>
                            <p className="mt-0.5 font-mono text-xs text-gray-400">{variant.sku}</p>
                          </td>
                          {visibleWarehouses.map((w) => (
                            <td key={w.id} className="px-4 py-2.5">
                              {isEditing ? (
                                <StockInput
                                  value={draft[cellKey(variant.id, w.id)] ?? ''}
                                  saved={variant.cells[w.id] ?? 0}
                                  onChange={(text) =>
                                    setDraft((prev) => ({ ...prev, [cellKey(variant.id, w.id)]: text }))
                                  }
                                />
                              ) : (
                                <span className="tabular-nums text-gray-700">{variant.cells[w.id] ?? 0}</span>
                              )}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-sm font-medium tabular-nums text-gray-600">
                            {variant.total}
                          </td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      ))}

                    {/* Bilah aksi mode edit: ringkasan perubahan + Undo / Batal / Simpan.
                        Ditaruh sebagai baris sendiri (bukan di kolom Aksi) karena butuh ruang untuk
                        menampilkan "lama → baru" tiap sel yang berubah. */}
                    {isEditing && (
                      <tr className="bg-amber-50">
                        <td colSpan={totalColumns} className="px-4 py-3">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0 text-sm">
                              {editState.changes.length === 0 ? (
                                <p className="text-gray-600">
                                  Belum ada perubahan. Ubah angka pada kolom gudang, lalu tekan Simpan.
                                </p>
                              ) : (
                                <p className="text-gray-700">
                                  <strong>{editState.changes.length} perubahan belum disimpan:</strong>{' '}
                                  {editState.changes
                                    .map((c) => {
                                      const warehouseName =
                                        warehouses.find((w) => w.id === c.warehouseId)?.nama ?? 'gudang'
                                      const variantName = c.variantId
                                        ? (product.variants.find((v) => v.id === c.variantId)?.name ?? '')
                                        : ''
                                      const before = savedValue(product, c.variantId, c.warehouseId)
                                      const label = variantName ? `${warehouseName} · ${variantName}` : warehouseName
                                      return `${label}: ${before} → ${c.stok}`
                                    })
                                    .join(' · ')}
                                </p>
                              )}
                              {editState.hasEmpty && (
                                <p className="mt-1 text-xs font-medium text-red-600">
                                  Ada sel kosong. Isi angkanya (0 bila memang habis) atau tekan Undo.
                                </p>
                              )}
                              {editState.invalid && (
                                <p className="mt-1 text-xs font-medium text-red-600">{editState.invalid}</p>
                              )}
                            </div>

                            <div className="flex flex-none items-center gap-2">
                              <button
                                type="button"
                                onClick={undoDraft}
                                disabled={editState.changes.length === 0 && !editState.hasEmpty && !editState.invalid}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Pulihkan semua angka baris ini ke nilai tersimpan"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Undo
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-400"
                              >
                                Batal
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmOpen(true)}
                                disabled={
                                  editState.changes.length === 0 || editState.hasEmpty || Boolean(editState.invalid)
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Simpan
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* === Kaki halaman: jumlah baris + tautan riwayat === */}
      <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-gray-500">
          {loading ? 'Memuat…' : `${filtered.length} produk`}
          {warehouseFilter !== 'all' && ' · kolom gudang lain disembunyikan (data tetap utuh)'}
        </p>
        <Link
          href="/oms/dashboard/gudang/riwayat"
          className="inline-flex items-center gap-1.5 font-medium text-emerald-700 transition hover:text-emerald-800"
        >
          <History className="h-4 w-4" />
          Lihat riwayat perubahan stok
        </Link>
      </div>

      {/* === Dialog konfirmasi === */}
      {confirmOpen && editingProduct && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => !saving && setConfirmOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="konfirmasi-stok-judul"
              className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="konfirmasi-stok-judul" className="text-base font-bold text-gray-900">
                    Simpan perubahan stok?
                  </h2>
                  <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">{editingProduct.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={saving}
                  aria-label="Tutup"
                  className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Rekap per sel: inilah yang dibaca admin sebelum menekan tombol terakhir. */}
              <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {editState.changes.map((c) => {
                  const warehouseName = warehouses.find((w) => w.id === c.warehouseId)?.nama ?? 'Gudang'
                  const variantName = c.variantId
                    ? (editingProduct.variants.find((v) => v.id === c.variantId)?.name ?? '')
                    : ''
                  const before = savedValue(editingProduct, c.variantId, c.warehouseId)
                  const delta = c.stok - before
                  return (
                    <li
                      key={`${c.variantId ?? 'p'}:${c.warehouseId}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0 text-gray-700">
                        {warehouseName}
                        {variantName && <span className="text-gray-500"> · {variantName}</span>}
                      </span>
                      <span className="flex flex-none items-center gap-2 tabular-nums">
                        <span className="text-gray-400 line-through">{before}</span>
                        <span className="font-bold text-gray-900">{c.stok}</span>
                        <span
                          className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>

              <p className="mt-3 text-xs text-gray-500">
                Perubahan langsung memengaruhi stok yang dilihat pembeli, dan tercatat di Riwayat
                Mutasi beserta nama akun Anda.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={saving}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
                >
                  Periksa lagi
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Ya, Simpan
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* === Toast + tawaran undo setelah simpan === */}
      {(toast || undoOffer) && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
            <Check className="h-4 w-4 flex-none text-emerald-400" />
            <p className="min-w-0 flex-1">{toast}</p>
            {undoOffer && (
              <button
                type="button"
                onClick={() => void handleUndoSaved()}
                disabled={undoing}
                className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20 disabled:opacity-50"
              >
                {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Batalkan
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setToast('')
                setUndoOffer(null)
              }}
              aria-label="Tutup notifikasi"
              className="flex-none rounded p-1 text-white/60 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </PageShell>
  )
}

// === Input satu sel dalam mode edit ===

// Sengaja TIDAK memakai <input type="number">: panah spinner-nya mudah tersenggol saat men-scroll
// tabel. Sel yang nilainya berbeda dari tersimpan ditandai kuning + keterangan "lama → baru".
function StockInput({
  value,
  saved,
  onChange,
}: {
  value: string
  saved: number
  onChange: (text: string) => void
}) {
  const trimmed = value.trim()
  const empty = trimmed === ''
  const parsed = Number(trimmed)
  const changed = !empty && !Number.isNaN(parsed) && parsed !== saved
  const delta = changed ? parsed - saved : 0

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        // Non-digit disaring saat mengetik; batas atas & aturan lain dicek saat Simpan (dan di server).
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        aria-invalid={empty}
        className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm tabular-nums outline-none transition focus:ring-2 ${
          empty
            ? 'border-red-400 text-gray-800 focus:border-red-500 focus:ring-red-100'
            : changed
              ? 'border-amber-400 bg-amber-50 font-semibold text-gray-900 focus:border-amber-500 focus:ring-amber-100'
              : 'border-gray-300 text-gray-800 focus:border-emerald-500 focus:ring-emerald-100'
        }`}
      />
      {changed && (
        <p className="mt-1 flex items-center gap-1 text-[11px] leading-tight text-amber-800">
          <span className="line-through">{saved}</span>→<span className="font-semibold">{parsed}</span>
          <span className={delta > 0 ? 'text-emerald-700' : 'text-red-600'}>
            ({delta > 0 ? `+${delta}` : delta})
          </span>
        </p>
      )}
    </div>
  )
}

// Total baris saat mode edit: pratinjau hasil draft, plus nilai tersimpan bila berbeda.
function PreviewTotal({
  product,
  draft,
  warehouses,
  savedTotal,
}: {
  product: MatrixProduct
  draft: Record<string, string>
  warehouses: MatrixWarehouse[]
  savedTotal: number
}) {
  // Dihitung dari draft untuk SEMUA gudang aktif (bukan hanya kolom yang tampil), supaya angkanya
  // tetap sebanding dengan kolom Stok di halaman Produk.
  let total = 0
  for (const w of warehouses) {
    if (product.hasVariants) {
      for (const v of product.variants) {
        const text = draft[cellKey(v.id, w.id)]
        total += text === undefined || text.trim() === '' ? (v.cells[w.id] ?? 0) : Number(text)
      }
    } else {
      const text = draft[cellKey(undefined, w.id)]
      total += text === undefined || text.trim() === '' ? (product.cells[w.id] ?? 0) : Number(text)
    }
  }

  const changed = total !== savedTotal
  return (
    <span className="flex flex-col">
      <span className={changed ? 'font-bold text-amber-800' : ''}>{total}</span>
      {changed && <span className="text-[11px] font-normal text-gray-400 line-through">{savedTotal}</span>}
    </span>
  )
}
