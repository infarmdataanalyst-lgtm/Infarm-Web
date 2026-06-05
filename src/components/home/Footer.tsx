// src/components/home/Footer.tsx
// Section 5 homepage: footer berisi achievement, sertifikasi, sitemap, sosial media, copyright.
// Server Component, responsive (stack di mobile → multi-kolom di desktop).

import Link from 'next/link'

// Daftar pencapaian (placeholder teks; TODO: ganti dengan gambar badge asli)
const ACHIEVEMENTS = ['Brand Choice Awards', 'TikTok Most Wanted Brand', '#1 Pupuk Organik Cair Shopee']

// Tag sertifikasi yang bisa diklik menuju katalog dengan kata kunci terkait
const CERTIFICATION_TAGS = ['POC Buah', 'Miracle Powder', 'Benih', 'Pupuk', 'Media Tanam']

// Tautan sitemap utama
const SITEMAP = [
  { label: 'Home', href: '/' },
  { label: 'Products', href: '/produk' },
  { label: 'Affiliate', href: '/affiliate' },
  { label: 'Reseller', href: '/reseller' },
  { label: 'Career', href: '/career' },
]

// Placeholder ikon sosial media (TODO: ganti dengan ikon library/aset asli)
const SOCIAL = [
  { label: 'Instagram', icon: '📷', href: '#' },
  { label: 'TikTok', icon: '🎵', href: '#' },
  { label: 'Facebook', icon: '👍', href: '#' },
  { label: 'YouTube', icon: '▶️', href: '#' },
]

// Menampilkan footer homepage dengan achievement, sertifikasi, sitemap, dan sosial media.
export default function Footer() {
  // Tahun copyright dihitung otomatis
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto w-full bg-brand-primary text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* === Our Achievements === */}
        <section className="text-center">
          <h2 className="inline-block rounded-md bg-black/15 px-5 py-2 text-base font-bold uppercase tracking-wide">
            Our Achievements
          </h2>
          <ul className="mt-5 flex flex-wrap justify-center gap-3">
            {ACHIEVEMENTS.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-white/50 px-4 py-2 text-sm font-medium"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* === Bersertifikasi === */}
        <section className="mt-8 text-center">
          <h2 className="inline-block rounded-md bg-black/15 px-5 py-2 text-base font-bold uppercase tracking-wide">
            Bersertifikat
          </h2>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {CERTIFICATION_TAGS.map((tag) => (
              <li key={tag}>
                <Link
                  href={`/produk?search=${encodeURIComponent(tag)}`}
                  className="inline-block rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium transition hover:bg-white/25"
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* === Brand, sitemap & sosmed === */}
        <div className="mt-10 grid grid-cols-1 gap-8 border-t border-white/20 pt-8 sm:grid-cols-2">
          {/* Brand + deskripsi + sosmed */}
          <div>
            <p className="text-3xl font-bold lowercase">infarm</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/90">
              infarm hadir sebagai teman belajar berkebunmu. Dari langkah pertama hingga panen,
              infarm memberikan solusi lengkap agar siapa pun bisa berkebun dengan mudah dan
              percaya diri.
            </p>
            <ul className="mt-4 flex gap-3">
              {SOCIAL.map((s) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    aria-label={s.label}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg transition hover:bg-white/25"
                  >
                    <span aria-hidden>{s.icon}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Sitemap */}
          <nav className="sm:justify-self-end" aria-label="Jelajahi pilihan">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/80">
              Jelajahi Pilihan
            </h3>
            <ul className="mt-4 space-y-3">
              {SITEMAP.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="font-medium transition hover:text-white/80">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* === Copyright === */}
        <p className="mt-10 text-center text-sm text-white/80">
          © {year} infarm. Hak Cipta Dilindungi.
        </p>
      </div>
    </footer>
  )
}
