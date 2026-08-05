'use client'

// src/components/home/ValuePropositionBanner.tsx
// Section 2 homepage: banner keunggulan belanja di infarm.
// Carousel horizontal yang bisa digeser di mobile; otomatis sejajar di layar lebar.
// Client Component: kartu muncul dengan animasi scroll-reveal (fade-in + translateY) berurutan
// (stagger) saat section masuk viewport — via IntersectionObserver native (tanpa library), once.

import { useEffect, useRef, useState } from 'react'

// Satu keunggulan/value proposition
type ValueProp = {
  icon: string // emoji placeholder (TODO: ganti dengan ikon/gambar asli)
  title: string
  description: string
}

// Daftar 4 keunggulan utama berbelanja langsung di website infarm
const VALUE_PROPS: ValueProp[] = [
  {
    icon: '💰',
    title: 'Harga Lebih Murah',
    description:
      'Tanpa biaya admin marketplace. Selisihnya langsung jadi hemat untuk kamu.',
  },
  {
    icon: '🚚',
    title: 'Gratis Ongkir',
    description:
      'Pembelian di atas Rp150K gratis ongkos kirim ke seluruh Jawa & Bali.',
  },
  {
    icon: '📦',
    title: 'Jaminan Return atau Refund',
    description:
      'Belanja gak perlu was-was. Kalau produk bermasalah, langsung kami ganti.',
  },
  {
    icon: '💬',
    title: 'Konsultasi Gratis',
    description:
      'Tanya langsung ke minfarm via WhatsApp. Kami bantu dari awal sampai panen.',
  },
]

// Menampilkan banner alasan membeli di website infarm sebagai carousel kartu.
export default function ValuePropositionBanner() {
  // Ref section untuk deteksi masuk viewport; `revealed` memicu animasi kartu (sekali saja).
  const sectionRef = useRef<HTMLElement>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    // Hormati preferensi gerakan minim: langsung tampil tanpa animasi.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealed(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRevealed(true)
          observer.disconnect() // once: true — tak berulang
        }
      },
      { threshold: 0.2 }, // picu saat ~20% section terlihat
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Background terang (brand-surface) = sama dengan section produk agar menyatu. Kartu putih.
  return (
    <section
      ref={sectionRef}
      className="w-full bg-[#FFFBEB] text-zinc-900"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* === Heading === (eyebrow aksen earthy; judul sentence case + font display) */}
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-soil">
          Keuntungan Eksklusif
        </p>
        <h2 className="mt-1 text-2xl font-bold leading-tight text-zinc-900 sm:text-3xl">
          Kenapa harus beli di website infarm
        </h2>

        {/* === Kartu === */}
        {/* Mobile: carousel geser horizontal (snap). Desktop (md+): grid statis, semua kartu
            tampil penuh tanpa scroll. overflow-x-auto & snap DINONAKTIFKAN mulai md agar tak
            ada scroll horizontal sisa layout mobile. */}
        <ul
          className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-hide md:grid md:snap-none md:grid-cols-2 md:overflow-visible lg:grid-cols-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {VALUE_PROPS.map((vp, index) => (
            <li
              key={vp.title}
              // Scroll-reveal: fade-in + translateY(24px→0). transform/opacity → tak sebabkan layout shift.
              // Stagger via transition-delay per kartu (jeda 120ms). transition-all durasi 500ms ease-out.
              style={{ transitionDelay: revealed ? `${index * 120}ms` : '0ms' }}
              className={`min-w-[260px] flex-1 snap-start rounded-2xl border border-zinc-200 border-t-4 border-t-brand-primary bg-white p-4 shadow-md transition-all duration-500 ease-out hover:shadow-lg md:min-w-0 ${
                revealed ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`}
            >
              {/* Baris atas: ikon + judul sejajar → kartu lebih ringkas */}
              <div className="flex items-center gap-3">
                {/* Emoji dalam lingkaran hijau soft agar "pop" tanpa mewarnai kartu */}
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E8F5E0] text-xl"
                  aria-hidden
                >
                  {vp.icon}
                </span>
                <h3 className="text-base font-bold leading-tight text-zinc-900">{vp.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                {vp.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
