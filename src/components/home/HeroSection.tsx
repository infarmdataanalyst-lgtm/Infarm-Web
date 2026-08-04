// src/components/home/HeroSection.tsx
// Section 1 homepage: floating search, headline marketing, dan trust badges di atas background hero.
// Catatan: app bar dipindah ke components/ui/AppBar.tsx (dirender di layout) agar tidak terjebak
// stacking context section ini dan selalu tampil di atas saat scroll.
// Server Component — belum ada interaktivitas. Responsive mobile → desktop.

import Image from 'next/image'
import Link from 'next/link'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import HeroStats from './HeroStats'

// Path gambar background hero. Taruh file di: public/images/hero-background.jpg
const HERO_IMAGE_PATH = '/images/hero-background.jpg'

// Menampilkan bagian hero teratas homepage: background, kolom pencarian, judul marketing,
// dan tiga trust badge. Menyesuaikan diri dari mobile hingga layar lebar.
// Catatan: saran pencarian kini diambil client-side on-type via /api/products/search
// (dulu seluruh katalog dikirim sebagai prop → payload beranda berat). Hero tak perlu fetch produk lagi.
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
        className="absolute inset-0 -z-20 bg-gradient-to-b from-brand-soil/30 via-brand-cream to-brand-light"
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
          unoptimized
          sizes="100vw"
          className="-z-10 object-cover object-center"
        />
      )}
      {/* === Konten hero === */}
      {/* flex-col + justify-between membagi ruang vertikal: grup atas (search+judul), CTA di tengah,
          dan kartu statistik menempel di bawah. Dengan 3 grup, jarak antar grup sama → CTA persis
          di tengah antara judul dan kartu. Berlaku di semua ukuran layar.
          pt besar memberi ruang untuk AppBar fixed. */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between px-4 pt-20 pb-12 sm:px-6 sm:pt-24 lg:px-8">
        {/* Grup atas: headline (search bar kini persisten di header, tak lagi di hero) */}
        <div>
          {/* Marketing headline — putih, dengan drop-shadow agar tetap terbaca di atas background */}
          <h1 className="max-w-2xl font-sans text-4xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] sm:text-5xl lg:text-6xl">
            Berkebun Jadi Mudah
            <br />
            Pasti Panen
          </h1>
        </div>

        {/* CTA utama (di tengah) — wrapper agar tombol tetap selebar kontennya & rata kiri */}
        <div>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-7 py-3 text-base font-bold text-white shadow-md transition hover:brightness-90 active:scale-[0.98]"
          >
            Belanja Sekarang
            <ArrowRightIcon />
          </Link>
        </div>

        {/* Trust indicators (di bawah) — tanpa box, di atas foto hero, dipisah garis vertikal,
            angka beranimasi count-up saat mount (client component) */}
        <HeroStats />
      </div>
    </section>
  )
}

// === Sub-komponen ===

// Ikon panah ke kanan (inline SVG) untuk tombol CTA "Belanja Sekarang"
function ArrowRightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

