// src/app/oms/dashboard/products/upload/page.tsx
// Halaman Upload Produk Baru OMS Infarm.
// Form input data produk untuk ecommerce internal Infarm (tanpa integrasi marketplace pihak ketiga).
// Sidebar disediakan otomatis oleh layout /oms/dashboard. Data masih dummy/simulasi.
// TODO: hubungkan submit ke Supabase setelah OMS dibangun.

import Link from 'next/link'
import Image from 'next/image'
import { ChevronRight, UploadCloud, Check, X } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'

// === Data ===

// Gambar preview simulasi (memakai placeholder produk yang ada)
const PREVIEW_IMAGES = [
  '/images/product-placeholder.png',
  '/images/product-placeholder.png',
  '/images/product-placeholder.png',
]

export default function UploadProductPage() {
  return (
    <>
      <OmsHeader title="Produk" notificationCount={3} />

      {/* pb-24 memberi ruang agar konten tidak tertutup footer sticky */}
      <main className="p-6 pb-28 md:p-8 md:pb-28">
        {/* === Breadcrumbs === */}
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/oms/dashboard/products" className="hover:text-gray-600">
            Produk
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-gray-600">Tambah Produk Baru</span>
        </nav>

        {/* === Judul Halaman === */}
        <div className="mt-2">
          <h2 className="text-2xl font-bold text-gray-900">Upload Produk Baru</h2>
          <p className="mt-1 text-sm text-gray-500">
            Lengkapi detail produk untuk ditampilkan di ecommerce Infarm.
          </p>
        </div>

        {/* === Konten Form === */}
        <div className="mx-auto mt-6 max-w-3xl">
          <div className="space-y-6">
            {/* --- Seksi 1: Informasi Dasar --- */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Informasi Dasar</h3>

              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="SKU Produk">
                  <input
                    type="text"
                    defaultValue="INF-SM-001"
                    placeholder="Contoh: INF-SM-001"
                    className={inputClass}
                  />
                </Field>
                <Field label="Nama Produk">
                  <input
                    type="text"
                    defaultValue="Media Tanam Organik Super"
                    placeholder="Contoh: Media Tanam Organik Super"
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Harga">
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-gray-200 px-3 text-sm font-medium text-gray-500">
                      Rp
                    </span>
                    <input
                      type="number"
                      min={0}
                      defaultValue={35000}
                      placeholder="0"
                      className={`${inputClass} pl-12`}
                    />
                  </div>
                </Field>
                <Field label="Stok Tersedia">
                  <input
                    type="number"
                    min={0}
                    defaultValue={120}
                    placeholder="0"
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="mt-5">
                <Field label="Deskripsi Produk">
                  <textarea
                    rows={5}
                    placeholder="Jelaskan spesifikasi produk: komposisi media (sekam, kompos, cocopeat), volume kemasan, manfaat untuk pertumbuhan akar, anjuran pemakaian, serta informasi garansi mutu & kebijakan retur jika kemasan rusak saat diterima."
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                </Field>
              </div>
            </section>

            {/* --- Seksi 2: Media Produk --- */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Media Produk</h3>

              {/* Kotak Drag & Drop */}
              <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <UploadCloud className="h-6 w-6" />
                </span>
                <span className="mt-3 text-sm font-semibold text-gray-700">
                  Tarik dan lepas gambar di sini
                </span>
                <span className="mt-1 text-xs text-gray-400">
                  atau klik untuk memilih file · Maksimal 5MB per file
                </span>
                {/* Input file disembunyikan (simulasi, belum diproses) */}
                <input type="file" accept="image/*" multiple className="hidden" />
              </label>

              {/* Area Preview gambar terunggah (simulasi) */}
              <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-4">
                {PREVIEW_IMAGES.map((src, index) => (
                  <div
                    key={index}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                  >
                    <Image
                      src={src}
                      alt={`Gambar produk ${index + 1}`}
                      fill
                      unoptimized
                      sizes="120px"
                      className="object-cover"
                    />
                    {/* Gambar pertama = Primary Image (centang hijau) */}
                    {index === 0 ? (
                      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        <Check className="h-3 w-3" />
                        Utama
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label="Hapus gambar"
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900/60 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* === Footer Sticky === */}
      {/* lg:left-64 menyelaraskan footer dengan area konten (di luar sidebar 64) */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-6 py-3.5 md:left-64">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Draft tersimpan otomatis (14:20)
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/oms/dashboard/products"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Batal
            </Link>
            <button
              type="button"
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Simpan &amp; Upload ke e-commerce
            </button>
          </div>
        </div>
      </footer>
    </>
  )
}

// === Sub-komponen & Helper ===

// Kelas dasar input agar konsisten di seluruh form
const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

// Wrapper label + field
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  )
}
