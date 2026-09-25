'use client'

// src/components/ui/MiniCart.tsx
// Panel mini cart (flyout) yang menempel di bawah ikon keranjang — KHUSUS desktop (≥640px);
// di mobile ikon keranjang tetap menavigasi ke /keranjang (lihat CartIconLink). Pemisahan itu
// STRUKTURAL, bukan lewat kelas responsif: di mobile komponen ini tidak pernah di-mount, jadi
// kontrol jumlah di bawah tak perlu penjagaan breakpoint tambahan.
//
// Isi: promo (semua yang tercapai + satu terdekat dengan progress bar), daftar item (kontrol jumlah, thumbnail, nama,
// harga, hapus), subtotal, tombol "Lihat Keranjang" & "Checkout".
//
// Sumber data = cookie keranjang (reaktif via useSyncExternalStore), sama seperti halaman
// keranjang. Karena keduanya membaca store yang sama, perubahan jumlah di sini LANGSUNG terlihat
// di /keranjang tanpa sinkronisasi tambahan — bukan dua salinan state yang perlu didamaikan.
//
// Nama, foto, stok & minimum pembelian TIDAK ada di cookie → di-resolve lewat
// GET /api/products/by-ids (cached 30s), dan hanya di-fetch saat panel dibuka agar tidak
// membebani setiap kunjungan halaman.

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, Gift, Package, ShoppingBag, Trash2 } from 'lucide-react'
import {
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
  updateQuantity,
  removeFromCart,
  removeComboFromCart,
  setComboCountInCart,
} from '@/lib/cart-client'
import { cartLineKey, comboMultiplier } from '@/lib/cart-lines'
import { formatRupiah } from '@/lib/format'
import {
  computePromoProgress,
  eligibleFreeProductIds,
  unavailableGiftIds,
  type PromoProgress,
} from '@/lib/promo-cart'
import type { StoredProduct } from '@/types/product'
import type { ProductCombo } from '@/types/combo'
import type { Promotion } from '@/types/promotion'

// Maksimal tinggi area daftar sebelum discroll (≈3 baris item — baris kini lebih tinggi karena
// memuat kontrol jumlah)
const LIST_MAX_HEIGHT = 'max-h-80'

// Satu baris siap render: gabungan item cookie + detail produk hasil resolve.
type MiniCartLine = {
  key: string
  productId: string
  variantId?: string
  // Anggota paket: jumlahnya dikunci (diatur per paket di halaman keranjang) dan menghapusnya
  // mengeluarkan seluruh paket — paket hanya sah bila utuh.
  comboId?: string
  name: string
  imageUrl: string
  variantName?: string
  quantity: number
  price: number
  // Minimum pembelian produk (batas bawah tombol "−"). 1 = bebas.
  minQty: number
  // Stok efektif; undefined bila produk belum ter-resolve atau bukan produk OMS (mis. dummy) —
  // saat itu tombol "+" TIDAK dibatasi, karena membatasi ke angka yang tak diketahui akan
  // memblokir pembelian yang sebenarnya sah.
  stock?: number
}

// Satu paket siap render: kepala paket + anggota-anggotanya (tanpa kontrol per anggota).
type MiniCartCombo = {
  comboId: string
  name: string
  members: MiniCartLine[]
  // Jumlah paket; null = isi keranjang tak lagi cocok dengan definisi paket (basi/dinonaktifkan)
  count: number | null
  // Batas jumlah paket menurut stok; null = tak diketahui
  max: number | null
}

type MiniCartEntry = { kind: 'line'; line: MiniCartLine } | { kind: 'combo'; combo: MiniCartCombo }

// Menampilkan isi keranjang ringkas + kontrol ubah jumlah. `open` mengatur visibilitas + animasi;
// komponen tetap ter-mount agar transisi muncul & hilang sama-sama halus.
export default function MiniCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  // Detail produk hasil resolve dari server (nama, foto, stok, minimum pembelian)
  const [products, setProducts] = useState<StoredProduct[]>([])

  // === Promo aktif ===
  //
  // Diambil ulang tiap panel dibuka (endpoint cached di server) agar promo yang baru kedaluwarsa /
  // dinonaktifkan tak tertinggal selama header tetap ter-mount lintas navigasi. Gagal → strip
  // promo tidak tampil, panel lain tetap jalan.
  const [promos, setPromos] = useState<Promotion[]>([])
  // Jam acuan evaluasi masa berlaku promo — diambil saat promo tiba (Date.now() tak boleh
  // dipanggil saat render).
  const [promoNowMs, setPromoNowMs] = useState(0)
  const adaIsi = cart.length > 0
  useEffect(() => {
    if (!open || !adaIsi) return
    const controller = new AbortController()
    fetch('/api/promotions/active', { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { promotions?: Promotion[] }) => {
        if (Array.isArray(data.promotions)) {
          setPromos(data.promotions)
          setPromoNowMs(Date.now())
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open, adaIsi])

  // Key stabil (diurut) supaya fetch hanya berulang saat kumpulan id benar-benar berubah.
  // Produk hadiah promo ikut di-resolve agar baris hadiah punya nama & foto (dan stoknya bisa
  // diperiksa) begitu syarat belanjanya tercapai.
  const idsKey = useMemo(() => {
    const ids = new Set(cart.map((c) => c.productId))
    for (const p of promos) if (p.type === 'free_product' && p.freeProductId) ids.add(p.freeProductId)
    return Array.from(ids).sort().join(',')
  }, [cart, promos])

  // Fetch hanya saat panel terbuka & ada isi keranjang
  useEffect(() => {
    if (!open || !idsKey) return
    const controller = new AbortController()
    fetch(`/api/products/by-ids?ids=${encodeURIComponent(idsKey)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { products?: StoredProduct[] }) => setProducts(data.products ?? []))
      .catch(() => {
        // Abort saat panel ditutup / id berubah — abaikan. Error lain → tampilkan data seadanya.
      })
    return () => controller.abort()
  }, [open, idsKey])

  // Definisi paket aktif (nama & isi per paket) — dasar judul kartu paket dan jumlah paket (N).
  // Hanya diambil saat panel terbuka DAN keranjang memuat paket. null = belum/tidak termuat.
  const [combos, setCombos] = useState<ProductCombo[] | null>(null)
  const adaPaket = cart.some((c) => c.comboId)
  useEffect(() => {
    if (!open || !adaPaket) return
    const controller = new AbortController()
    fetch('/api/combos/active', { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { combos?: ProductCombo[] }) => {
        if (Array.isArray(data.combos)) setCombos(data.combos)
      })
      .catch(() => {
        // Abort / gagal → kartu paket tetap tampil dengan nama umum, stepper paket nonaktif.
      })
    return () => controller.abort()
  }, [open, adaPaket])

  // Gabungkan item cookie dengan detail produk. Baris = produk + varian + paket (lib/cart-lines.ts).
  const lines: MiniCartLine[] = useMemo(() => {
    return cart.map((item) => {
      const product = products.find((p) => p.id === item.productId)
      return {
        key: cartLineKey(item),
        productId: item.productId,
        variantId: item.variantId,
        ...(item.comboId ? { comboId: item.comboId } : {}),
        name: product?.name ?? 'Memuat…',
        imageUrl: product?.imageUrl ?? '/images/product-placeholder.png',
        variantName: item.variantName,
        quantity: item.quantity,
        price: item.price,
        minQty: product && product.minOrderQty > 1 ? product.minOrderQty : 1,
        ...(product ? { stock: product.stock } : {}),
      }
    })
  }, [cart, products])

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  )

  // Promo yang ditampilkan di panel (sempit), dari SELURUH isi keranjang — beda dengan /keranjang
  // yang hanya menghitung item tercentang: mini cart tak punya checkbox, dan tombol Checkout di sini
  // memang membawa seluruh isi keranjang.
  //
  //   tercapai → SEMUA ditampilkan sebagai baris "Selamat!" ringkas: pembeli perlu tahu setiap
  //              hadiah yang ia dapat. Dulu hanya satu promo yang tampil, sehingga saat dua promo
  //              berjalan bersamaan yang lain tak terlihat sama sekali.
  //   belum    → hanya SATU dengan progress bar: yang sisanya terkecil (target paling realistis).
  //              Sisanya diringkas jadi tautan "+N promo lainnya" ke /keranjang, yang memuat semua.
  const promoSummary = useMemo(() => {
    // Hadiah yang stoknya habis di semua gudang → pesan jujur, bukan "Selamat!"
    const progress = computePromoProgress(promos, subtotal, unavailableGiftIds(promos, products))
    const tercapai = progress.filter((p) => p.reached)
    const belum = progress.filter((p) => !p.reached).sort((a, b) => a.remaining - b.remaining)
    return { tercapai, berikutnya: belum[0] ?? null, lainnya: Math.max(0, belum.length - 1) }
  }, [promos, subtotal, products])

  // === Produk hadiah promo yang sudah tercapai ===
  //
  // Dulu mini cart hanya menulis "Selamat! Kamu mendapatkan …" tanpa baris hadiahnya, sementara
  // halaman keranjang menampilkannya. Aturannya sama dengan server (eligibleFreeProductIds); hadiah
  // yang diarsipkan / stoknya habis tak ditampilkan — server pun tak akan memasukkannya.
  const freeItems = useMemo(() => {
    return eligibleFreeProductIds(promos, subtotal, promoNowMs).flatMap((id) => {
      const product = products.find((p) => p.id === id)
      if (!product || product.archived || product.stock <= 0) return []
      return [{ id, name: product.name, imageUrl: product.imageUrl }]
    })
  }, [promos, subtotal, promoNowMs, products])

  // === Susun daftar: baris satuan apa adanya, anggota paket dikumpulkan jadi SATU kartu paket ===
  //
  // Dulu tiap anggota paket tampil sebagai baris biasa dengan stepper yang dimatikan dan tombol
  // hapus sendiri — pembeli tak tahu kenapa tombolnya mati, bahwa ketiganya satu paket, atau cara
  // membeli dua paket. Sekarang sama dengan halaman keranjang: stepper di kepala paket saja.
  const entries: MiniCartEntry[] = useMemo(() => {
    const urutan: ({ kind: 'line'; line: MiniCartLine } | { kind: 'combo'; comboId: string })[] = []
    const anggota = new Map<string, MiniCartLine[]>()
    for (const line of lines) {
      if (!line.comboId) {
        urutan.push({ kind: 'line', line })
        continue
      }
      const ada = anggota.get(line.comboId)
      if (ada) ada.push(line)
      else {
        anggota.set(line.comboId, [line])
        urutan.push({ kind: 'combo', comboId: line.comboId })
      }
    }

    // Stok untuk paket = stok produk − yang dipakai baris SATUAN produk yang sama.
    const dipakaiSatuan = new Map<string, number>()
    for (const l of lines) {
      if (!l.comboId) dipakaiSatuan.set(l.productId, (dipakaiSatuan.get(l.productId) ?? 0) + l.quantity)
    }

    return urutan.map((e): MiniCartEntry => {
      if (e.kind === 'line') return e
      const members = anggota.get(e.comboId) ?? []
      const def = combos?.find((c) => c.id === e.comboId)
      const units = def?.items ?? []
      // Belum termuat → anggap 1 paket (stepper tetap nonaktif sampai definisinya tiba).
      const count = combos === null ? 1 : def ? comboMultiplier(units, members) : null
      let max: number | null = null
      for (const m of members) {
        const unit = units.find((u) => u.productId === m.productId)?.quantity
        if (m.stock === undefined || !unit) continue
        const cukup = Math.floor(Math.max(0, m.stock - (dipakaiSatuan.get(m.productId) ?? 0)) / unit)
        max = max === null ? cukup : Math.min(max, cukup)
      }
      return {
        kind: 'combo',
        combo: { comboId: e.comboId, name: def?.name ?? 'Paket', members, count, max },
      }
    })
  }, [lines, combos])

  // Ringkasan kepala panel: "1 paket + 1 produk", bukan jumlah baris mentah (anggota paket bukan
  // produk yang dipilih satu per satu).
  const ringkasan = useMemo(() => {
    const paket = entries.filter((e) => e.kind === 'combo').length
    const satuan = entries.length - paket
    const bagian = [
      ...(paket > 0 ? [`${paket} paket`] : []),
      ...(satuan > 0 ? [`${satuan} produk`] : []),
    ]
    return `${bagian.join(' + ')} di keranjang`
  }, [entries])

  // Ubah jumlah paket (isi per paket dari definisi DB). Turun dari 1 lewat tombol hapus, bukan "−".
  function setComboCount(comboId: string, next: number) {
    const def = combos?.find((c) => c.id === comboId)
    if (!def || next < 1) return
    setComboCountInCart(comboId, def.items, next)
  }

  // === Aksi ubah jumlah ===
  //
  // TIDAK ADA proses async di sini: stok & minimum pembelian sudah ikut terbawa saat panel dibuka,
  // jadi validasinya perbandingan angka di memori — nol request per klik, karena itu tak ada
  // indikator loading (memutar spinner tanpa ada yang ditunggu hanya memperlambat kesan).
  //
  // Batas stok di sini bersifat PEMANDU, bukan penegakan: datanya bisa basi ≤30 detik (endpoint
  // by-ids cached) dan untuk produk bervarian angkanya stok level-produk. Penegakan sebenarnya
  // ada di server saat checkout (RPC create_order_with_items → INSUFFICIENT_STOCK + rollback).

  function increment(line: MiniCartLine) {
    if (line.stock !== undefined && line.quantity >= line.stock) return
    updateQuantity(line.productId, line.quantity + 1, line.variantId)
  }

  // Batas bawah = minimum pembelian produk, BUKAN 0. Perilaku ini sengaja disamakan dengan
  // halaman keranjang penuh: "−" berhenti di batas dan penghapusan lewat tombol tersendiri,
  // supaya aturan tombol yang sama tidak berbeda di dua tempat.
  function decrement(line: MiniCartLine) {
    const next = Math.max(line.minQty, line.quantity - 1)
    if (next !== line.quantity) updateQuantity(line.productId, next, line.variantId)
  }

  // Checkout dari mini cart WAJIB menulis cookie `infarm_checkout` dulu — halaman /checkout
  // membaca cookie itu, bukan `infarm_cart` (lihat aturan sinkronisasi di CLAUDE.md).
  function handleCheckout() {
    setCheckoutItems(cart)
    onClose()
    router.push('/checkout')
  }

  return (
    <div
      role="dialog"
      aria-label="Ringkasan keranjang"
      className={`absolute right-0 top-full z-50 mt-2 w-96 origin-top-right overflow-hidden rounded-2xl border border-brand-light bg-white text-zinc-800 shadow-lg transition-all duration-200 ease-out ${
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
      }`}
    >
      {/* Kepala */}
      <div className="border-b border-brand-light/60 bg-brand-surface px-4 py-2.5">
        <p className="text-sm font-bold text-zinc-900">Keranjang</p>
        <p className="text-xs text-zinc-500">
          {cart.length > 0 ? ringkasan : 'Belum ada produk'}
        </p>
      </div>

      {cart.length === 0 ? (
        // === Keranjang kosong ===
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light/30 text-brand-primary">
            <ShoppingBag className="h-7 w-7" />
          </span>
          <p className="mt-3 text-sm font-bold text-zinc-900">Keranjang kamu masih kosong</p>
          <p className="mt-1 text-xs text-zinc-500">Yuk, cari benih dan pupuk untuk kebunmu.</p>
          <Link
            href="/products"
            onClick={onClose}
            className="mt-4 rounded-xl bg-brand-primary px-5 py-2 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
          >
            Mulai Belanja
          </Link>
        </div>
      ) : (
        <>
          {(promoSummary.tercapai.length > 0 || promoSummary.berikutnya) && (
            <MiniCartPromos
              tercapai={promoSummary.tercapai}
              berikutnya={promoSummary.berikutnya}
              lainnya={promoSummary.lainnya}
              onNavigate={onClose}
            />
          )}

          {/* === Daftar item (scroll bila lebih dari ±3 baris) === */}
          <ul className={`${LIST_MAX_HEIGHT} divide-y divide-zinc-100 overflow-y-auto`}>
            {entries.map((entry) =>
              entry.kind === 'combo' ? (
                <MiniCartComboCard
                  key={`combo::${entry.combo.comboId}`}
                  combo={entry.combo}
                  onSetCount={(n) => setComboCount(entry.combo.comboId, n)}
                  onRemove={() => removeComboFromCart(entry.combo.comboId)}
                />
              ) : (
                <MiniCartRow
                  key={entry.line.key}
                  line={entry.line}
                  onIncrement={() => increment(entry.line)}
                  onDecrement={() => decrement(entry.line)}
                  onRemove={() => removeFromCart(entry.line.productId, entry.line.variantId)}
                />
              ),
            )}
            {freeItems.map((item) => (
              <MiniCartFreeRow key={`hadiah::${item.id}`} name={item.name} imageUrl={item.imageUrl} />
            ))}
          </ul>

          {/* === Subtotal & aksi === */}
          <div className="border-t border-zinc-100 p-3">
            <div className="mb-3 flex items-baseline justify-between px-1">
              <span className="text-sm text-zinc-500">Subtotal</span>
              {/* key = nilai subtotal → elemen di-mount ulang tiap nilainya berubah sehingga
                  animasi sorotan otomatis diputar ulang (lihat .animate-value-flash) */}
              <span
                key={subtotal}
                className="animate-value-flash px-1 text-base font-bold text-brand-primary"
              >
                {formatRupiah(subtotal)}
              </span>
            </div>

            <div className="flex gap-2">
              <Link
                href="/keranjang"
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-300 py-2 text-center text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
              >
                Lihat Keranjang
              </Link>
              <button
                type="button"
                onClick={handleCheckout}
                className="flex-1 rounded-xl bg-brand-primary py-2 font-heading text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99]"
              >
                Checkout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Strip promo ringkas di atas daftar item: ikon + pesan, lalu progress bar tipis bila belum
// tercapai. Bahasa visual sama dengan CartPromoList di halaman keranjang, hanya dirampingkan.
function MiniCartPromos({
  tercapai,
  berikutnya,
  lainnya,
  onNavigate,
}: {
  tercapai: PromoProgress[]
  berikutnya: PromoProgress | null
  lainnya: number
  onNavigate: () => void
}) {
  return (
    <div className="space-y-1.5 border-b border-zinc-100 px-4 py-2.5" aria-live="polite">
      {/* Semua promo yang sudah tercapai */}
      {tercapai.map(({ promo, message, giftOutOfStock }) =>
        giftOutOfStock ? (
          // Syarat tercapai tapi stok hadiahnya habis — jangan dirayakan
          <div key={promo.id} className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none text-orange-600" />
            <p className="font-semibold text-orange-700">{message}</p>
          </div>
        ) : (
          <div key={promo.id} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-none text-brand-primary" />
            <p className="font-semibold text-brand-primary">{message}</p>
          </div>
        ),
      )}

      {/* Satu promo terdekat yang belum tercapai, dengan progress bar */}
      {berikutnya && (
        <div>
          <div className="flex items-start gap-2 text-xs">
            <Gift className="mt-px h-3.5 w-3.5 flex-none text-brand-primary" />
            <p className="text-zinc-700">{berikutnya.message}</p>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-brand-light/40">
            <div
              className="h-full rounded-full bg-brand-primary transition-all"
              style={{ width: `${berikutnya.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Promo belum tercapai lainnya → rinciannya di halaman keranjang */}
      {lainnya > 0 && (
        <Link
          href="/keranjang"
          onClick={onNavigate}
          className="block text-[11px] font-semibold text-brand-primary underline-offset-2 hover:underline"
        >
          +{lainnya} promo lainnya · Lihat Keranjang
        </Link>
      )}
    </div>
  )
}

// Satu baris produk hadiah promo: tanpa kontrol (jumlah & harga ditentukan promo, bukan pembeli).
// Bentuknya mengikuti MiniCartRow supaya sejajar, dengan penanda "Bonus Promo" dan "Gratis".
function MiniCartFreeRow({ name, imageUrl }: { name: string; imageUrl: string }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-3">
      <span className="flex shrink-0 items-center justify-center rounded-lg border border-brand-light px-2 py-0.5 text-xs font-semibold text-brand-primary">
        1× hadiah
      </span>
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
        <Image src={imageUrl} alt={name} fill unoptimized sizes="44px" className="object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-light/40 px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
          <Gift className="h-3 w-3" /> Bonus Promo
        </span>
        <span className="line-clamp-2 text-sm leading-snug text-zinc-800" title={name}>
          {name}
        </span>
        <span className="text-xs font-bold text-brand-primary">Gratis</span>
      </span>
    </li>
  )
}

// Satu baris mini cart: [− n +] [foto] [nama + harga + hapus].
// Kontrol jumlah memakai bahasa desain yang sama dengan CartItemRow di halaman keranjang penuh
// (kotak ber-border zinc-300, radius, tombol "−"/"+" polos), hanya diperkecil agar muat di panel.
// Bedanya: TANPA input ketik manual — di lebar 384px kolom angka yang bisa difokus hanya menambah
// jalur kesalahan, sedangkan pengetikan bebas sudah tersedia di halaman keranjang penuh.
function MiniCartRow({
  line,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  line: MiniCartLine
  onIncrement: () => void
  onDecrement: () => void
  onRemove: () => void
}) {
  const atMin = line.quantity <= line.minQty
  const atMax = line.stock !== undefined && line.quantity >= line.stock

  return (
    <li className="flex items-center gap-2.5 px-3 py-3">
      {/* Kontrol jumlah — paling kiri */}
      <div className="flex shrink-0 items-center rounded-lg border border-zinc-300">
        <button
          type="button"
          onClick={onDecrement}
          disabled={atMin}
          aria-label={`Kurangi jumlah ${line.name}`}
          className="px-2 py-0.5 text-base leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
        >
          −
        </button>
        {/* key = quantity → animasi sorotan diputar ulang tiap jumlahnya berubah */}
        <span
          key={line.quantity}
          aria-live="polite"
          className="animate-value-flash min-w-[2rem] border-x border-zinc-300 py-0.5 text-center text-sm font-semibold text-zinc-800"
        >
          {line.quantity}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          disabled={atMax}
          aria-label={`Tambah jumlah ${line.name}`}
          title={atMax ? `Stok tersisa ${line.stock}` : undefined}
          className="px-2 py-0.5 text-base leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
        >
          +
        </button>
      </div>

      {/* Foto produk */}
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
        {/* unoptimized: URL Supabase Storage belum didaftarkan di remotePatterns
            (pola sama dengan CartItemRow) */}
        <Image src={line.imageUrl} alt={line.name} fill unoptimized sizes="44px" className="object-cover" />
      </span>

      {/* Nama + harga */}
      <span className="min-w-0 flex-1">
        {/* line-clamp-2, bukan truncate: nama produk di katalog ini panjang ("INFARM - Benih Sayur
            Bayam Hijau Popspinach…") dan satu baris hanya menyisakan 3–4 kata. Sama dengan
            CartItemRow di halaman keranjang penuh.
            JANGAN tambahkan `block` di sini: line-clamp butuh `display: -webkit-box`, dan
            `block` menimpanya sehingga teksnya memanjang tanpa batas (baris jadi ~156px). */}
        <span className="line-clamp-2 text-sm leading-snug text-zinc-800" title={line.name}>
          {line.name}
        </span>
        {line.variantName && (
          <span className="block truncate text-xs text-zinc-400">{line.variantName}</span>
        )}
        <span className="mt-0.5 flex items-baseline gap-1.5 text-xs">
          <span className="text-zinc-500">
            {line.quantity} × {formatRupiah(line.price)}
          </span>
          <span
            key={line.price * line.quantity}
            className="animate-value-flash px-1 font-bold text-brand-primary"
          >
            {formatRupiah(line.price * line.quantity)}
          </span>
        </span>
        {/* Alasan tombol dinonaktifkan ditulis, bukan dibiarkan user menebak kenapa tak bisa diklik */}
        {atMax && <span className="block text-[11px] text-orange-600">Stok tersisa {line.stock}</span>}
        {line.minQty > 1 && (
          <span className="block text-[11px] text-orange-600">Min. beli {line.minQty} pcs</span>
        )}
      </span>

      {/* Hapus baris — jalur penghapusan terpisah, sama seperti halaman keranjang penuh */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Hapus ${line.name}`}
        className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 active:scale-95"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
}

// Satu paket di mini cart: kepala [ikon · nama · N paket · total] [− N +] [hapus], lalu anggota
// sebagai daftar ringkas (foto, nama, ×jumlah) TANPA kontrol — jumlahnya ikut jumlah paket.
// "−" berhenti di 1 paket; mengeluarkan paket lewat tombol hapus, sama dengan baris satuan.
function MiniCartComboCard({
  combo,
  onSetCount,
  onRemove,
}: {
  combo: MiniCartCombo
  onSetCount: (next: number) => void
  onRemove: () => void
}) {
  const { name, members, count, max } = combo
  const total = members.reduce((sum, m) => sum + m.price * m.quantity, 0)
  const rusak = count === null
  const bisaTambah = !rusak && (max === null || count < max)

  return (
    <li className="bg-brand-surface/70 px-3 py-3">
      {/* Kepala paket */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-primary">
          <Package className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-zinc-800" title={name}>
            {name}
          </span>
          <span className="block text-xs text-zinc-500">
            {count !== null ? `${count} paket · ` : ''}
            <span key={total} className="animate-value-flash px-0.5 font-bold text-brand-primary">
              {formatRupiah(total)}
            </span>
          </span>
        </span>

        <div className={`flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white ${rusak ? 'opacity-40' : ''}`}>
          <button
            type="button"
            onClick={() => count !== null && onSetCount(count - 1)}
            disabled={rusak || count <= 1}
            aria-label={`Kurangi jumlah ${name}`}
            className="px-2 py-0.5 text-base leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
          >
            −
          </button>
          <span
            key={count ?? 'x'}
            aria-live="polite"
            className="animate-value-flash min-w-[2rem] border-x border-zinc-300 py-0.5 text-center text-sm font-semibold text-zinc-800"
          >
            {count ?? '–'}
          </span>
          <button
            type="button"
            onClick={() => count !== null && onSetCount(count + 1)}
            disabled={!bisaTambah}
            aria-label={`Tambah jumlah ${name}`}
            title={!rusak && max !== null && count !== null && count >= max ? `Stok cukup untuk ${max} paket` : undefined}
            className="px-2 py-0.5 text-base leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Hapus ${name}`}
          title="Keluarkan seluruh paket"
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 active:scale-95"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {rusak && (
        <p className="mt-1.5 text-[11px] text-red-600">
          Isi paket sudah berubah. Hapus lalu tambahkan ulang dari halaman produk.
        </p>
      )}
      {!rusak && max !== null && count !== null && count >= max && (
        <p className="mt-1.5 text-[11px] text-orange-600">Stok cukup untuk {max} paket</p>
      )}

      {/* Anggota paket — ringkas, tanpa kontrol */}
      <ul className="mt-2 space-y-1.5 rounded-lg bg-white p-2">
        {members.map((m) => (
          <li key={m.key} className="flex items-center gap-2">
            <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-brand-surface">
              <Image src={m.imageUrl} alt={m.name} fill unoptimized sizes="32px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-700" title={m.name}>
              {m.name}
            </span>
            <span className="shrink-0 text-xs font-semibold text-zinc-500">×{m.quantity}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}
