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

// Basis nama file hero (art-direction). Taruh file di public/images/ dengan salah satu ekstensi
// jpg/webp/png:
//   Desktop/tablet (landscape 16:9)  → hero-background.(jpg|webp|png)
//   Mobile (portrait 9:16)           → hero-background-mobile.(jpg|webp|png)
// Bila file mobile belum ada, foto desktop dipakai juga di mobile (fallback).
const HERO_DESKTOP_BASE = 'hero-background'
const HERO_MOBILE_BASE = 'hero-background-mobile'

// Cari file hero di public/images/ dengan basis nama tertentu; coba jpg→webp→png.
// Kembalikan path publik yang ada, atau null. Server-only (Server Component) → aman pakai fs.
function resolveHeroImage(base: string): string | null {
  for (const ext of ['jpg', 'webp', 'png'] as const) {
    const rel = `/images/${base}.${ext}`
    if (existsSync(join(process.cwd(), 'public', rel))) return rel
  }
  return null
}

// Menampilkan bagian hero teratas homepage: background, kolom pencarian, judul marketing,
// dan tiga trust badge. Menyesuaikan diri dari mobile hingga layar lebar.
// Catatan: saran pencarian kini diambil client-side on-type via /api/products/search
// (dulu seluruh katalog dikirim sebagai prop → payload beranda berat). Hero tak perlu fetch produk lagi.
export default function HeroSection() {
  // Resolusi path tiap gambar hero (jpg/webp/png). Tak ada satupun → fallback ke gradient.
  // Mobile absen → foto desktop dipakai di semua ukuran.
  const desktopImage = resolveHeroImage(HERO_DESKTOP_BASE)
  const mobileImage = resolveHeroImage(HERO_MOBILE_BASE)

  return (
    <section className="relative isolate flex min-h-[80vh] flex-col overflow-hidden">
      {/* === Background hero === */}
      {/* Fallback gradient — selalu ada di lapisan paling belakang (-z-20) */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-gradient-to-b from-brand-soil/30 via-brand-cream to-brand-light"
      />
      {/* Foto MOBILE (portrait) — hanya tampil < sm. Sembunyi bila file belum ada (pakai desktop). */}
      {mobileImage && (
        <Image
          src={mobileImage}
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="-z-10 object-cover object-center sm:hidden"
        />
      )}
      {/* Foto DESKTOP/TABLET (landscape) — tampil sm+. Bila file mobile absen, tampil juga di
          mobile (tanpa `hidden`) sebagai fallback. `object-center` = titik fokus crop. */}
      {desktopImage && (
        <Image
          src={desktopImage}
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className={`-z-10 object-cover object-center ${mobileImage ? 'hidden sm:block' : ''}`}
        />
      )}
      {/* === Konten hero === */}
      {/* flex-col + justify-between: headline (atas), CTA (tengah), statistik (bawah).
          pt besar memberi ruang untuk AppBar fixed. */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between px-4 pt-20 pb-12 sm:px-6 sm:pt-24 lg:px-8">
        {/* Headline marketing — putih, drop-shadow agar tetap terbaca di atas background */}
        <div>
          <h1 className="max-w-2xl font-heading text-4xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] sm:text-5xl lg:text-6xl">
            Berkebun Jadi Mudah
            <br />
            Pasti Panen
          </h1>
        </div>

        {/* CTA utama — wrapper agar tombol tetap selebar kontennya & rata kiri */}
        <div>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-7 py-3 font-heading text-base font-bold text-white shadow-md transition hover:brightness-90 active:scale-[0.98]"
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

