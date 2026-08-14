'use client'

// src/components/ui/MiniCart.tsx
// Panel mini cart (flyout) yang menempel di bawah ikon keranjang — KHUSUS desktop (≥640px);
// di mobile ikon keranjang tetap menavigasi ke /keranjang (lihat CartIconLink). Pemisahan itu
// STRUKTURAL, bukan lewat kelas responsif: di mobile komponen ini tidak pernah di-mount, jadi
// kontrol jumlah di bawah tak perlu penjagaan breakpoint tambahan.
//
// Isi: daftar item (kontrol jumlah, thumbnail, nama, harga, hapus), subtotal, tombol
// "Lihat Keranjang" & "Checkout".
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
import { ShoppingBag, Trash2 } from 'lucide-react'
import {
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  setCheckoutItems,
  updateQuantity,
  removeFromCart,
} from '@/lib/cart-client'
import { formatRupiah } from '@/lib/format'
import type { StoredProduct } from '@/types/product'

// Maksimal tinggi area daftar sebelum discroll (≈3 baris item — baris kini lebih tinggi karena
// memuat kontrol jumlah)
const LIST_MAX_HEIGHT = 'max-h-80'

// Satu baris siap render: gabungan item cookie + detail produk hasil resolve.
type MiniCartLine = {
  key: string
  productId: string
  variantId?: string
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

// Menampilkan isi keranjang ringkas + kontrol ubah jumlah. `open` mengatur visibilitas + animasi;
// komponen tetap ter-mount agar transisi muncul & hilang sama-sama halus.
export default function MiniCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  // Detail produk hasil resolve dari server (nama, foto, stok, minimum pembelian)
  const [products, setProducts] = useState<StoredProduct[]>([])

  // Key stabil (diurut) supaya fetch hanya berulang saat kumpulan id benar-benar berubah
  const idsKey = useMemo(
    () => Array.from(new Set(cart.map((c) => c.productId))).sort().join(','),
    [cart],
  )

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

  // Gabungkan item cookie dengan detail produk. Baris = productId + variantId (varian = baris sendiri).
  const lines: MiniCartLine[] = useMemo(() => {
    return cart.map((item) => {
      const product = products.find((p) => p.id === item.productId)
      return {
        key: `${item.productId}::${item.variantId ?? ''}`,
        productId: item.productId,
        variantId: item.variantId,
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
          {cart.length > 0 ? `${cart.length} produk di keranjang` : 'Belum ada produk'}
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
          {/* === Daftar item (scroll bila lebih dari ±3 baris) === */}
          <ul className={`${LIST_MAX_HEIGHT} divide-y divide-zinc-100 overflow-y-auto`}>
            {lines.map((line) => (
              <MiniCartRow
                key={line.key}
                line={line}
                onIncrement={() => increment(line)}
                onDecrement={() => decrement(line)}
                onRemove={() => removeFromCart(line.productId, line.variantId)}
              />
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
