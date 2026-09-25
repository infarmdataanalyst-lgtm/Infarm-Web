// src/components/home/Footer.tsx
// Section 5 homepage: footer berisi achievement, sertifikasi, sitemap, sosial media, copyright.
// Server Component, responsive (stack di mobile → multi-kolom di desktop).

import Image from 'next/image'
import Link from 'next/link'
import { LEGAL_PAGES_ENABLED, PRIVACY_POLICY_PATH, TERMS_PATH } from '@/lib/data/legal'
import { WHATSAPP_CS_LINK } from '@/lib/data/contact'
import FooterHomeLink from '@/components/home/FooterHomeLink'

// Badge pencapaian (PNG transparan di public/images/achievements/). width/height = ukuran asli
// berkas, dipakai next/image untuk rasio aspek — tampilan akhirnya diatur lewat className.
const ACHIEVEMENTS = [
  { src: '/images/achievements/brand-choice-awards.png', alt: 'Brand Choice Awards 2025', width: 2175, height: 1377 },
  { src: '/images/achievements/tiktok-most-wanted-brand.png', alt: 'TikTok Most Wanted Brand', width: 2176, height: 1377 },
  { src: '/images/achievements/no-1-poc-shopee.png', alt: '#1 Pupuk Organik Cair di Shopee', width: 2154, height: 1364 },
]

// Panel nomor pendaftaran produk (satu gambar berisi seluruh produk bersertifikat)
const CERTIFICATION_IMAGE = {
  src: '/images/achievements/bersertifikat.png',
  alt: 'Produk infarm bersertifikat: POC Sayur, POC Cabai, POC Bunga, POC Buah, Miracle Powder, Pupuk Padat, Nutripod, dan Benih Premium — terdaftar atas nama PT. Kayuan Infarm Indonesia',
  width: 2000,
  height: 736,
}

// Tautan dokumen legal (rute dari @/lib/data/legal agar tak salah tulis di beberapa tempat)
const LEGAL_LINKS = [
  { label: 'Kebijakan Privasi', href: PRIVACY_POLICY_PATH },
  { label: 'Syarat & Ketentuan', href: TERMS_PATH },
]

// Tautan sitemap "Jelajahi Pilihan".
//
// `href: null` = halamannya BELUM ADA. Tampil sama persis dengan tautan lain, hanya tidak bisa
// diklik: sebelumnya ketiganya menunjuk /affiliate, /reseller, /career yang tak pernah dibuat,
// jadi pembeli yang mengkliknya mendarat di 404. Begitu halamannya dibuat, cukup isi `href`-nya
// di sini.
//
// Products menunjuk /products (katalog). Dulu /produk — rute itu hanya punya halaman detail
// /produk/[id], sehingga /produk sendiri 404.
const SITEMAP: { label: string; href: string | null }[] = [
  { label: 'Home', href: '/' },
  { label: 'Products', href: '/products' },
  { label: 'Affiliate', href: null },
  { label: 'Reseller', href: null },
  { label: 'Career', href: null },
]

// Ikon sosial media (inline SVG brand — tanpa aset/library, mengikuti warna teks via currentColor)
//
// WhatsApp ikut di baris ini sejak 2026-09-18, menggantikan tombol mengambang di kanan bawah.
// Alasannya bukan kerapian: tombol mengambang menempel di layar sepanjang pembeli menelusuri
// katalog, jadi ia mengajak pindah ke percakapan WhatsApp tepat ketika pembeli sedang berbelanja
// di web. Di footer, kanal CS tetap ada tapi baru ditemui saat pembeli memang sedang mencarinya.
//
// WHATSAPP_CS_LINK masih '/404' selama WHATSAPP_CS_NUMBER di @/lib/data/contact belum diisi —
// begitu nomornya masuk, ikon ini otomatis mengarah ke wa.me tanpa mengubah berkas ini.
const SOCIAL = [
  { label: 'Instagram', Icon: InstagramIcon, href: 'https://www.instagram.com/infarm.id/' },
  { label: 'TikTok', Icon: TiktokIcon, href: 'https://www.tiktok.com/@infarmid' },
  { label: 'Facebook', Icon: FacebookIcon, href: '' }, // sementara kosong: tidak ada aksi saat diklik
  { label: 'YouTube', Icon: YoutubeIcon, href: 'https://youtube.com/@infarmid' },
  { label: 'WhatsApp', Icon: WhatsAppIcon, href: WHATSAPP_CS_LINK },
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
          {/* Mobile: 2 kolom (badge ketiga di tengah baris kedua). Desktop: satu baris.
              Tiap PNG punya ruang transparan ±17% di kiri-kanan dan ±13% di bawah laurel. Gambar
              dilebarkan 134% dengan margin negatif agar laurelnya mengisi lebar kolom — tanpa itu
              badge tampak kecil dengan celah lebar. Aman karena bagian yang meluber transparan;
              overflow-x-clip memotongnya agar tak memicu scroll horizontal di layar sempit. */}
          <ul className="mt-6 flex flex-wrap justify-center gap-x-2 gap-y-4 overflow-x-clip md:gap-x-10">
            {ACHIEVEMENTS.map((badge) => (
              <li key={badge.src} className="w-[calc(50%-0.25rem)] max-w-[190px] md:w-44">
                <Image
                  src={badge.src}
                  alt={badge.alt}
                  width={badge.width}
                  height={badge.height}
                  sizes="(min-width: 768px) 236px, 67vw"
                  className="-mx-[17%] -mb-[11%] h-auto w-[134%] max-w-none object-contain"
                />
              </li>
            ))}
          </ul>
        </section>

        {/* === Bersertifikasi === */}
        <section className="mt-10 text-center">
          <h2 className="inline-block rounded-md bg-black/15 px-5 py-2 text-base font-bold uppercase tracking-wide">
            Bersertifikat
          </h2>
          {/* Satu panel lebar berisi nomor pendaftaran — dibatasi di desktop agar tak mendominasi
              footer, selebar layar di mobile supaya teksnya tetap terbaca. */}
          <Image
            src={CERTIFICATION_IMAGE.src}
            alt={CERTIFICATION_IMAGE.alt}
            width={CERTIFICATION_IMAGE.width}
            height={CERTIFICATION_IMAGE.height}
            sizes="(min-width: 768px) 672px, 100vw"
            className="mx-auto mt-6 h-auto w-full object-contain md:max-w-2xl"
          />
        </section>

        {/* === Brand, sitemap & sosmed === */}
        <div className="mt-10 grid grid-cols-1 gap-8 border-t border-white/20 pt-8 sm:grid-cols-2">
          {/* Brand + deskripsi + sosmed */}
          <div>
            {/* Wordmark → font merek (bukan font teks isi) */}
            <p className="font-heading text-3xl font-bold lowercase">infarm</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/90">
              infarm hadir sebagai teman belajar berkebunmu. Dari langkah pertama hingga panen,
              infarm memberikan solusi lengkap agar siapa pun bisa berkebun dengan mudah dan
              percaya diri.
            </p>
            <ul className="mt-4 flex gap-3">
              {SOCIAL.map((s) => {
                // Tab baru hanya untuk tautan ke situs lain. Tautan dalam aplikasi (WhatsApp yang
                // masih '/404' selama nomornya belum diisi) dibuka di tab yang sama — membuka
                // halaman 404 di tab baru meninggalkan tab kosong yang harus ditutup pembeli.
                const eksternal = s.href.startsWith('http')
                return (
                <li key={s.label}>
                  {s.href ? (
                    <Link
                      href={s.href}
                      aria-label={s.label}
                      target={eksternal ? '_blank' : undefined}
                      rel={eksternal ? 'noopener noreferrer' : undefined}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
                    >
                      <s.Icon />
                    </Link>
                  ) : (
                    // Belum ada URL → elemen statis, tidak ada aksi saat diklik
                    <span
                      aria-label={s.label}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"
                    >
                      <s.Icon />
                    </span>
                  )}
                </li>
                )
              })}
            </ul>
          </div>

          {/* Sitemap */}
          <nav className="sm:justify-self-end" aria-label="Jelajahi pilihan">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/80">
              Jelajahi Pilihan
            </h3>
            <ul className="mt-4 space-y-3">
              {SITEMAP.map((link) => (
                <li key={link.label}>
                  {link.href === '/' ? (
                    // Home: di beranda menggulir ke paling atas (lihat FooterHomeLink)
                    <FooterHomeLink className="font-medium transition hover:text-white/80">
                      {link.label}
                    </FooterHomeLink>
                  ) : link.href ? (
                    <Link href={link.href} className="font-medium transition hover:text-white/80">
                      {link.label}
                    </Link>
                  ) : (
                    // Halaman belum ada → teks statis bergaya sama, tidak bisa diklik
                    <span className="font-medium">{link.label}</span>
                  )}
                </li>
              ))}
            </ul>

            {/* Dokumen legal — dipisah dari sitemap agar mudah ditemukan.
                Seluruh section disembunyikan saat LEGAL_PAGES_ENABLED = false: menyisakan judul
                "Legal" tanpa isi hanya memancing pertanyaan. */}
            {LEGAL_PAGES_ENABLED && (
              <>
                <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-white/80">Legal</h3>
                <ul className="mt-3 space-y-3">
                  {LEGAL_LINKS.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="font-medium transition hover:text-white/80">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
        </div>

        {/* === Copyright + tautan legal ringkas (tautan ikut nonaktif bersama halamannya) === */}
        <div className="mt-10 flex flex-col items-center gap-2 text-sm text-white/80">
          <p>© {year} infarm. Hak Cipta Dilindungi.</p>
          {LEGAL_PAGES_ENABLED && (
            <p className="flex flex-wrap justify-center gap-x-2">
              <Link href={PRIVACY_POLICY_PATH} className="underline underline-offset-2 transition hover:text-white">
                Kebijakan Privasi
              </Link>
              <span aria-hidden>·</span>
              <Link href={TERMS_PATH} className="underline underline-offset-2 transition hover:text-white">
                Syarat &amp; Ketentuan
              </Link>
            </p>
          )}
        </div>
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

// WhatsApp: lucide-react tak menyediakan ikon brand, jadi inline SVG seperti ikon sosial lain di
// berkas ini (tanpa menambah dependency ikon baru, sesuai aturan CLAUDE.md). Ukuran & fill sengaja
// sama persis dengan tetangganya supaya sebarisnya rata.
function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.548 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488" />
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
