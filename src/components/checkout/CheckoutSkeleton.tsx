// src/components/checkout/CheckoutSkeleton.tsx
// Kerangka (skeleton) halaman checkout selama detail produk masih dimuat.
//
// ── Kenapa ada ──
// Cookie `infarm_checkout` hanya menyimpan { productId, quantity, price } — nama & foto produk
// diambil terpisah lewat API. Selama tarikan itu berjalan, item belum bisa dipetakan ke produk dan
// halaman DULU menyimpulkan "keranjang kosong", lalu menampilkan pesan "Belum ada produk untuk
// dibayar" kepada pembeli yang baru saja menekan Beli Langsung. Skeleton ini yang menggantikan
// kesimpulan prematur itu.
//
// ── Kenapa meniru tata letak, bukan spinner ──
// Bentuknya sengaja sama dengan halaman aslinya (kartu produk → alamat → kurir → pembayaran →
// ringkasan, satu kolom di mobile, dua kolom di lg+). Kotak yang ukurannya mendekati isi
// sebenarnya membuat halaman tidak melompat saat data tiba — spinner di tengah layar justru
// menyembunyikan bentuk halaman lalu menggantinya mendadak.

// Satu blok abu berdenyut. `aria-hidden` di root menahan seluruhnya dari pembaca layar; statusnya
// diumumkan sekali lewat role="status" di bawah, bukan sebagai puluhan kotak tanpa makna.
function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-zinc-200 ${className}`} />
}

// Pembungkus kartu — menyalin bentuk `CheckoutCard` di halaman checkout: polos di mobile,
// berbingkai di lg+.
function SkeletonCard({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`bg-white p-4 lg:rounded-2xl lg:border lg:border-zinc-200 lg:shadow-sm ${className}`}
    >
      {children}
    </div>
  )
}

// Kerangka halaman checkout. Dipakai saat keadaan halaman = LOADING.
export default function CheckoutSkeleton() {
  return (
    <>
      {/* Diumumkan SEKALI, bukan per kotak. Pembaca layar butuh tahu "sedang memuat", bukan
          mendengar daftar elemen kosong. */}
      <p role="status" aria-live="polite" className="sr-only">
        Memuat rincian pesanan…
      </p>

      <div
        aria-hidden
        className="mx-auto w-full max-w-6xl flex-1 animate-pulse space-y-2 pb-32 lg:grid lg:grid-cols-[3fr_2fr] lg:grid-rows-[repeat(5,auto)] lg:items-start lg:gap-x-6 lg:gap-y-4 lg:space-y-0 lg:px-8 lg:pb-12 lg:pt-6"
      >
        {/* 1 — Ringkasan produk (kanan di desktop) */}
        <SkeletonCard className="lg:col-start-2">
          <Bar className="mb-3 h-4 w-32" />
          <div className="flex gap-3">
            <Bar className="h-16 w-16 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-3.5 w-full" />
              <Bar className="h-3.5 w-2/3" />
              <Bar className="h-4 w-24" />
            </div>
          </div>
        </SkeletonCard>

        {/* 2 — Form alamat (kiri di desktop, kolomnya paling tinggi) */}
        <SkeletonCard className="lg:col-start-1 lg:row-span-5 lg:row-start-1">
          <Bar className="mb-4 h-5 w-40" />

          <div className="space-y-4">
            {/* Nama & telepon */}
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1.5">
                <Bar className="h-3 w-28" />
                <Bar className="h-10 w-full" />
              </div>
            ))}

            {/* Pencarian alamat */}
            <div className="space-y-1.5">
              <Bar className="h-3 w-56" />
              <Bar className="h-10 w-full" />
            </div>

            {/* Lima kolom wilayah hasil auto-isi — 2 kolom, kode pos menyendiri */}
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Bar className="h-3 w-20" />
                  <Bar className="h-10 w-full" />
                </div>
              ))}
            </div>

            {/* Alamat lengkap (textarea) */}
            <div className="space-y-1.5">
              <Bar className="h-3 w-64" />
              <Bar className="h-24 w-full" />
            </div>
          </div>
        </SkeletonCard>

        {/* 3 — Baris metode pengiriman */}
        <SkeletonCard className="lg:col-start-2">
          <div className="flex items-center gap-3">
            <Bar className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3 w-28" />
              <Bar className="h-4 w-44" />
            </div>
            <Bar className="h-5 w-5 shrink-0" />
          </div>
        </SkeletonCard>

        {/* 4 — Metode pembayaran (informasi) */}
        <SkeletonCard className="lg:col-start-2">
          <Bar className="mb-3 h-4 w-36" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Bar key={i} className="h-8 w-16" />
            ))}
          </div>
        </SkeletonCard>

        {/* 5 — Ringkasan biaya */}
        <SkeletonCard className="lg:col-start-2">
          <Bar className="mb-3 h-4 w-32" />
          <div className="space-y-2.5">
            {[0, 1].map((i) => (
              <div key={i} className="flex justify-between">
                <Bar className="h-3.5 w-24" />
                <Bar className="h-3.5 w-20" />
              </div>
            ))}
            <div className="border-t border-dashed border-zinc-200 pt-2.5">
              <div className="flex justify-between">
                <Bar className="h-4 w-16" />
                <Bar className="h-4 w-28" />
              </div>
            </div>
          </div>
        </SkeletonCard>

        {/* 6 — Panel total + tombol bayar (hanya lg+, sama seperti aslinya) */}
        <div className="hidden lg:col-start-2 lg:block">
          <SkeletonCard>
            <Bar className="h-3 w-28" />
            <Bar className="mt-1.5 h-6 w-36" />
            <Bar className="mt-3 h-12 w-full" />
          </SkeletonCard>
        </div>
      </div>

      {/* Bilah bayar mengambang — mobile saja, meniru CheckoutBottomBar varian sticky */}
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 z-30 animate-pulse border-t border-zinc-200 bg-white lg:hidden"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-3 pt-2">
          <div className="min-w-0 space-y-1.5">
            <Bar className="h-3 w-24" />
            <Bar className="h-5 w-28" />
          </div>
          <Bar className="ml-auto h-11 w-32 shrink-0 rounded-xl" />
        </div>
      </div>
    </>
  )
}
