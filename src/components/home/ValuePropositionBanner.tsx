// src/components/home/ValuePropositionBanner.tsx
// Section 2 homepage: banner keunggulan belanja di infarm.
// Carousel horizontal yang bisa digeser di mobile; otomatis sejajar di layar lebar. Server Component.

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
  return (
    <section className="w-full bg-brand-primary text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* === Heading === */}
        <p className="text-sm font-medium uppercase tracking-wide text-white/80">
          Keuntungan Eksklusif
        </p>
        <h2 className="mt-1 text-2xl font-bold uppercase leading-tight sm:text-3xl">
          Kenapa Harus Beli di Website infarm
        </h2>

        {/* === Carousel kartu === */}
        {/* Geser horizontal di mobile (snap); di layar lebar keempat kartu tampil sejajar. */}
        <ul
          className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-hide"
          style={{ WebkitOverflowScrolling: 'touch', width: '100%' }}
        >
          {VALUE_PROPS.map((vp) => (
            <li
              key={vp.title}
              className="min-w-[260px] flex-1 snap-start rounded-2xl bg-brand-light p-5 shadow-sm"
            >
              <span className="text-3xl" aria-hidden>
                {vp.icon}
              </span>
              {/* Teks gelap agar kontras di atas kartu hijau muda (brand-light) */}
              <h3 className="mt-3 text-lg font-bold text-zinc-900">{vp.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                {vp.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
