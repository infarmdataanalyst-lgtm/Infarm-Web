// src/components/cart/CartItemsSkeleton.tsx
// Kerangka daftar item keranjang selama detail produk masih di-resolve dari server.
//
// Alasannya sama dengan CheckoutSkeleton: cookie hanya menyimpan { productId, quantity, price },
// sedangkan nama & foto datang dari `/api/products/by-ids`. Selama tarikan itu berjalan, item belum
// bisa dipetakan dan halaman DULU langsung menyimpulkan "Keranjang kamu masih kosong" — padahal
// isinya ada, hanya belum bernama.
//
// Jumlah baris mengikuti jumlah item di cookie (yang SUDAH diketahui sejak render pertama), jadi
// tinggi halaman tak melompat saat data tiba.

// Satu baris item palsu — meniru tata letak CartItemRow: checkbox, foto, nama, harga, stepper.
function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-4">
      <div className="mt-1 h-5 w-5 shrink-0 rounded bg-zinc-200" />
      <div className="h-20 w-20 shrink-0 rounded-lg bg-zinc-200" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-full rounded bg-zinc-200" />
        <div className="h-3.5 w-3/5 rounded bg-zinc-200" />
        <div className="h-4 w-24 rounded bg-zinc-200" />
        <div className="flex items-center justify-between pt-1">
          <div className="h-4 w-16 rounded bg-zinc-200" />
          <div className="h-8 w-24 rounded-lg bg-zinc-200" />
        </div>
      </div>
    </div>
  )
}

// Kerangka daftar keranjang. `rows` = jumlah item di cookie.
export default function CartItemsSkeleton({ rows = 1 }: { rows?: number }) {
  // Dibatasi supaya keranjang berisi puluhan item tak merender puluhan kerangka — di atas ambang
  // ini bentuk halamannya sudah tersampaikan.
  const jumlah = Math.min(Math.max(rows, 1), 4)

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Memuat isi keranjang…
      </p>
      <div
        aria-hidden
        className="mt-3 animate-pulse divide-y divide-zinc-100 lg:mt-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-zinc-100"
      >
        {Array.from({ length: jumlah }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </>
  )
}
