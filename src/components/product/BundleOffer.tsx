'use client'

// src/components/product/BundleOffer.tsx
// Seksi "Beli Kombo Lebih Hemat" di halaman detail produk. Menampilkan paket/combo REAL dari
// Supabase yang memuat produk ini (data disiapkan server di page.tsx).
//
// Kontrol tiap kartu:
//   belum di keranjang → tombol "+ Tambah Paket" (1 paket masuk, harga paket, ditandai comboId)
//   sudah di keranjang → stepper "− N +" JUMLAH PAKET; "−" di 1 paket mengeluarkan paketnya
//
// Dulu kontrolnya checkbox: pembeli tak menangkapnya sebagai tombol beli, dan tak ada cara membeli
// lebih dari satu paket selain dari halaman keranjang. Stepper ini sengaja tinggal DI DALAM kartu
// paket, terpisah dari "− n +" milik produk satuan di bilah bawah (StickyBuyBar) — dua kontrol,
// dua tempat, supaya menambah paket tak pernah tertukar dengan menambah produk ini satuan.
//
// Angkanya dibaca reaktif dari keranjang (useSyncExternalStore), jadi selalu sama dengan stepper
// di kepala paket pada halaman keranjang dan tetap benar setelah reload.

import Image from 'next/image'
import { useSyncExternalStore } from 'react'
import { calcNormalPrice, type ProductCombo } from '@/types/combo'
import { formatRupiah } from '@/lib/format'
import {
  addComboToCart,
  removeComboFromCart,
  setComboCountInCart,
  showCartToast,
  CART_BUMP_EVENT,
  subscribeCart,
  getCartSnapshot,
  getServerCartSnapshot,
} from '@/lib/cart-client'
import { comboMultiplier } from '@/lib/cart-lines'
import { allocateComboPrices } from '@/lib/promo-cart'
import { trackComboAddToCart } from '@/lib/analytics'
import type { CartItem } from '@/types/cart'

const PLACEHOLDER = '/images/product-placeholder.png'

// Keadaan satu paket di keranjang saat ini.
//   count  — jumlah paket (0 = belum di keranjang; null = isinya tak lagi cocok dengan paket)
//   max    — batas jumlah paket menurut stok; null = stok tak diketahui (tak dibatasi di sini,
//            penegakan tetap di server)
function comboState(
  combo: ProductCombo,
  cart: CartItem[],
  stockById: Record<string, number>,
): { count: number | null; max: number | null } {
  const lines = cart.filter((c) => c.comboId === combo.id)
  const count = lines.length === 0 ? 0 : comboMultiplier(combo.items, lines)

  // Stok untuk paket = stok produk − yang sudah dipakai baris SATUAN produk yang sama di keranjang
  // (A satuan dan A di dalam paket mengambil dari stok yang sama).
  let max: number | null = null
  for (const it of combo.items) {
    const stock = stockById[it.productId]
    if (typeof stock !== 'number' || it.quantity < 1) continue
    const satuan = cart
      .filter((c) => !c.comboId && c.productId === it.productId)
      .reduce((sum, c) => sum + c.quantity, 0)
    const cukup = Math.floor(Math.max(0, stock - satuan) / it.quantity)
    max = max === null ? cukup : Math.min(max, cukup)
  }
  return { count, max }
}

// Menampilkan daftar kartu combo hemat beserta kontrol jumlah paketnya.
export default function BundleOffer({
  combos,
  imageById,
  stockById = {},
}: {
  combos: ProductCombo[]
  imageById: Record<string, string>
  stockById?: Record<string, number>
}) {
  // Baca keranjang secara reaktif dari cookie (snapshot server kosong agar tidak mismatch saat hidrasi).
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  if (combos.length === 0) return null

  // Masukkan SATU paket (harga combo dialokasikan per produk) + toast.
  function addCombo(combo: ProductCombo) {
    const allocated = allocateComboPrices(combo.items, combo.comboPrice)
    addComboToCart(combo.id, allocated)
    // GA4 add_to_cart: SATU event berisi semua item combo (nama dari snapshot, harga hasil alokasi).
    // Dikirim SETELAH item masuk cookie keranjang (konsisten dengan jalur produk tunggal).
    trackComboAddToCart(
      combo.comboPrice,
      allocated.map((a) => ({
        productId: a.productId,
        name: combo.items.find((it) => it.productId === a.productId)?.name ?? '',
        price: a.price,
        quantity: a.quantity,
      })),
    )
    window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT))
    showCartToast('Paket kombo berhasil ditambahkan ke keranjang!')
  }

  // Ubah jumlah paket. Turun dari 1 = keluarkan paket, dengan konfirmasi — satu klik yang tak
  // sengaja tak boleh menghapus beberapa produk sekaligus tanpa pemberitahuan.
  function setCount(combo: ProductCombo, next: number) {
    if (next < 1) {
      if (window.confirm(`Keluarkan ${combo.name} dari keranjang?`)) removeComboFromCart(combo.id)
      return
    }
    setComboCountInCart(combo.id, combo.items, next)
    window.dispatchEvent(new CustomEvent(CART_BUMP_EVENT))
  }

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-2 text-sm font-bold text-zinc-800">Beli Kombo Lebih Hemat</h2>

      <div className="space-y-2">
        {combos.map((combo) => {
          const normal = calcNormalPrice(combo.items)
          const savings = Math.max(0, normal - combo.comboPrice)
          const { count, max } = comboState(combo, cart, stockById)
          const diKeranjang = count !== 0
          const rusak = count === null
          const bisaTambah = max === null || (count ?? 0) < max

          return (
            <div
              key={combo.id}
              className={`rounded-xl border bg-brand-surface p-3 transition ${
                diKeranjang ? 'border-brand-primary' : 'border-brand-light'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Foto produk-produk combo, dipisah ikon plus (maks 3) */}
                <div className="flex shrink-0 items-center gap-1">
                  {combo.items.slice(0, 3).map((item, idx) => (
                    <div key={item.productId} className="flex items-center gap-1">
                      {idx > 0 && <span className="text-lg font-bold text-brand-primary">+</span>}
                      <ComboThumb src={imageById[item.productId] ?? PLACEHOLDER} alt={item.name} />
                    </div>
                  ))}
                </div>

                {/* Info harga hemat + rincian produk (collapsible) */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs text-zinc-600">
                    Beli bareng <span className="font-semibold">{combo.name}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-base font-bold text-brand-primary">{formatRupiah(combo.comboPrice)}</span>
                    {savings > 0 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-500">
                        Hemat {formatRupiah(savings)}
                      </span>
                    )}
                  </div>

                  {/* Rincian isi combo — collapsible agar kartu tetap ringkas (default tertutup) */}
                  <details className="mt-1 text-xs text-zinc-500">
                    <summary className="cursor-pointer list-none font-medium text-brand-primary marker:hidden">
                      Lihat isi paket ({combo.items.length} produk)
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {combo.items.map((item) => (
                        <li key={item.productId} className="truncate">
                          {item.name} <span className="text-zinc-400">x{item.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </div>

              {/* === Kontrol jumlah PAKET === */}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-brand-light/60 pt-3">
                {!diKeranjang ? (
                  <>
                    <span className="text-xs text-zinc-500">
                      {max === 0 ? 'Stok paket sedang habis' : 'Harga paket berlaku untuk seluruh isi paket'}
                    </span>
                    <button
                      type="button"
                      onClick={() => addCombo(combo)}
                      disabled={max === 0}
                      className="shrink-0 rounded-lg bg-brand-primary px-4 py-2 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.98] disabled:opacity-40"
                    >
                      + Tambah Paket
                    </button>
                  </>
                ) : rusak ? (
                  <>
                    <span className="text-xs font-medium text-red-700">
                      Isi paket di keranjang sudah berubah. Hapus lalu tambahkan ulang.
                    </span>
                    <button
                      type="button"
                      onClick={() => removeComboFromCart(combo.id)}
                      className="shrink-0 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 transition active:scale-[0.98]"
                    >
                      Hapus
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-brand-primary">✓ Paket di keranjang</p>
                      <p className="text-xs text-zinc-500">
                        {count} paket · {formatRupiah(combo.comboPrice * (count ?? 0))}
                      </p>
                      {!bisaTambah && <p className="text-[11px] text-orange-600">Stok cukup untuk {max} paket</p>}
                    </div>
                    <div className="flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white">
                      <button
                        type="button"
                        onClick={() => setCount(combo, (count ?? 1) - 1)}
                        aria-label={`Kurangi jumlah ${combo.name}`}
                        className="px-3 py-1.5 text-lg leading-none text-zinc-600 transition active:scale-95"
                      >
                        −
                      </button>
                      <span
                        aria-live="polite"
                        className="min-w-[2.5rem] border-x border-zinc-300 py-1.5 text-center text-sm font-semibold text-zinc-800"
                      >
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCount(combo, (count ?? 0) + 1)}
                        disabled={!bisaTambah}
                        aria-label={`Tambah jumlah ${combo.name}`}
                        className="px-3 py-1.5 text-lg leading-none text-zinc-600 transition active:scale-95 disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// === Sub-komponen ===

// Thumbnail kecil 1 produk di dalam kartu kombo
function ComboThumb({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded-lg border border-zinc-100 bg-white">
      <Image src={src} alt={alt} fill unoptimized sizes="56px" className="object-cover" />
    </div>
  )
}
