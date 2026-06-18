// src/app/review/submitted/page.tsx
// Halaman konfirmasi "Ulasan Terkirim" setelah user mengirim ulasan dari /review.
// Membaca ?order= untuk menampilkan ID pesanan terkait (opsional).
// Warna mengikuti palet brand di CLAUDE.md (brand.primary/light/surface).

import Link from 'next/link'
import { CheckCircle2, Home, ShoppingBag } from 'lucide-react'

export default async function ReviewSubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order } = await searchParams

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-surface px-5 py-12">
      <div className="w-full max-w-md text-center">
        {/* === Ilustrasi sukses === */}
        <div className="flex justify-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-light/60">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-primary text-white shadow-lg">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>
        </div>

        {/* === Pesan utama === */}
        <h1 className="mt-6 text-2xl font-bold text-zinc-900">Ulasan Terkirim!</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">
          Terima kasih telah berbagi pengalaman berkebunmu. Ulasanmu sangat membantu pembeli lain.
        </p>
        {order && (
          <p className="mt-2 text-xs text-zinc-400">Untuk pesanan #{order}</p>
        )}

        {/* === Aksi === */}
        <div className="mt-8 space-y-3">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-primary py-3.5 text-sm font-bold text-white transition hover:brightness-95"
          >
            <Home className="h-4 w-4" />
            Kembali ke Beranda
          </Link>
          <Link
            href="/products"
            className="flex items-center justify-center gap-2 rounded-xl border border-brand-primary py-3.5 text-sm font-bold text-brand-primary transition hover:bg-brand-light/30"
          >
            <ShoppingBag className="h-4 w-4" />
            Belanja Lagi
          </Link>
        </div>
      </div>
    </div>
  )
}
