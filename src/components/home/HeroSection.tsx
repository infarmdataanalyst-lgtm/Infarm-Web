// src/components/home/HeroSection.tsx
// Section 1 homepage: floating search, headline marketing, dan trust badges di atas background hero.
// Catatan: app bar dipindah ke components/ui/AppBar.tsx (dirender di layout) agar tidak terjebak
// stacking context section ini dan selalu tampil di atas saat scroll.
// Server Component — belum ada interaktivitas. Responsive mobile → desktop.

import Image from 'next/image'
import Link from 'next/link'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Path gambar background hero. Taruh file di: public/images/hero-background.jpg
const HERO_IMAGE_PATH = '/images/hero-background.jpg'

// Menampilkan bagian hero teratas homepage: background, kolom pencarian, judul marketing,
// dan tiga trust badge. Menyesuaikan diri dari mobile hingga layar lebar.
export default function HeroSection() {
  // Cek ketersediaan file gambar hero agar tidak muncul broken image bila belum di-upload.
  // Jika file ada → tampilkan <Image> responsive; jika belum → fallback ke gradient.
  const heroImageExists = existsSync(join(process.cwd(), 'public', HERO_IMAGE_PATH))

  return (
    <section className="relative isolate flex min-h-[80vh] flex-col overflow-hidden">
      {/* === Background hero === */}
      {/* Fallback gradient — selalu ada di lapisan paling belakang (-z-20) */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-gradient-to-b from-sky-200 via-sky-100 to-green-200"
      />
      {/* Gambar background responsive: `fill` + `object-cover` mengisi penuh section dan
          crop proporsional di semua ukuran layar (mobile/tablet/desktop). `object-center`
          mengatur titik fokus — ganti ke object-top/object-bottom bila perlu.
          Tampil otomatis begitu file public/images/hero-background.jpg tersedia. */}
      {heroImageExists && (
        <Image
          src={HERO_IMAGE_PATH}
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover object-center"
        />
      )}
      {/* Overlay gelap tipis agar teks tetap kontras di atas gambar/gradient */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-black/10" />

      {/* === Konten hero === */}
      {/* pt besar memberi ruang untuk AppBar fixed; konten dibatasi max-w-6xl agar rapi di layar lebar */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-20 pb-12 sm:px-6 sm:pt-24 lg:px-8">
        {/* Floating search input */}
        <div className="flex max-w-xl items-center gap-2 rounded-full border border-white/60 bg-white/70 px-5 py-3 shadow-md backdrop-blur-sm">
          <input
            type="text"
            placeholder="Media tanam"
            aria-label="Cari produk"
            className="w-full bg-transparent text-base text-zinc-700 placeholder:text-zinc-500 focus:outline-none"
          />
          <SearchIcon className="shrink-0 text-zinc-600" />
        </div>

        {/* Marketing headline — putih, dengan drop-shadow agar tetap terbaca di atas background */}
        <h1 className="mt-8 max-w-2xl font-sans text-4xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] sm:text-5xl lg:text-6xl">
          Berkebun Jadi Mudah
          <br />
          Pasti Panen
        </h1>

        {/* CTA utama — kapsul lonjong menuju katalog semua produk (/products, tanpa filter) */}
        <Link
          href="/products"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-primary px-7 py-3 text-base font-bold text-white shadow-md transition hover:brightness-90 active:scale-[0.98]"
        >
          Belanja Sekarang
          <ArrowRightIcon />
        </Link>

        {/* Trust badges — vertikal di mobile, sejajar di layar lebih besar */}
        <ul className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <TrustBadge highlight="3,4 Juta +" label="Pembeli Puas" />
          <TrustBadge highlight="4.9" label="Rating Produk" />
          <TrustBadge highlight="100%" label="Produk Original" />
        </ul>
      </div>
    </section>
  )
}

// === Sub-komponen ===

// Satu kotak trust badge semi-transparan dengan angka highlight (hijau) dan label di bawahnya
function TrustBadge({ highlight, label }: { highlight: string; label: string }) {
  return (
    <li className="rounded-xl bg-white/60 px-4 py-2 text-center shadow-sm backdrop-blur-sm sm:min-w-[150px]">
      <p className="text-2xl font-extrabold text-brand-primary">{highlight}</p>
      <p className="text-sm font-medium text-zinc-800">{label}</p>
    </li>
  )
}

// Ikon panah ke kanan (inline SVG) untuk tombol CTA "Belanja Sekarang"
function ArrowRightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

// Ikon kaca pembesar (inline SVG) untuk kolom pencarian hero
function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
