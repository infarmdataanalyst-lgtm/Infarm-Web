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

// Ikon sosial media (inline SVG brand — tanpa aset/library, mengikuti warna teks via currentColor)
const SOCIAL = [
  { label: 'Instagram', Icon: InstagramIcon, href: '#' },
  { label: 'TikTok', Icon: TiktokIcon, href: '#' },
  { label: 'Facebook', Icon: FacebookIcon, href: '#' },
  { label: 'YouTube', Icon: YoutubeIcon, href: '#' },
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
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
                  >
                    <s.Icon />
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

// === Ikon sosial media (inline SVG, path resmi brand, fill mengikuti warna teks) ===

function InstagramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  )
}

function TiktokIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function YoutubeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}
