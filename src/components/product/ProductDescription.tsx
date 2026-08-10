'use client'

// src/components/product/ProductDescription.tsx
// Seksi deskripsi / spesifikasi produk, dipotong 5 baris dengan tombol "Lihat Selengkapnya".
// Mempertahankan baris baru dari teks deskripsi (whitespace-pre-line).
//
// Kenapa client: perlu mengukur apakah teks benar-benar terpotong. Menebak dari jumlah karakter
// tidak akurat — deskripsi produk berisi baris baru & baris pendek ("Isi bersih: 50 gr"), sehingga
// teks pendek pun bisa melebihi 5 baris dan teks panjang bisa tidak.

import { useCallback, useRef, useState } from 'react'

// Tinggi maksimum saat terpotong = 5 baris. Dihitung dari text-sm (0.875rem) × leading-relaxed
// (1.625) agar tepat memotong di batas baris, bukan memenggal setengah huruf.
const COLLAPSED_MAX_HEIGHT = 'calc(5 * 1.625 * 0.875rem)'

// Batas atas animasi saat terbuka. Nilainya sengaja jauh lebih besar dari deskripsi mana pun —
// max-height perlu angka konkret supaya bisa ditransisikan (transisi ke `none` tidak berjalan).
const EXPANDED_MAX_HEIGHT = '200rem'

// Menampilkan deskripsi produk dengan pemotongan 5 baris + tombol buka/tutup.
// Tombol hanya muncul bila teksnya memang melebihi batas.
export default function ProductDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // Pengukuran hanya sahih saat teks sedang terpotong: begitu terbuka, scrollHeight == clientHeight
  // dan tombolnya akan hilang sendiri. Status dibaca lewat ref agar callback pengukur tidak perlu
  // dibuat ulang tiap kali `expanded` berubah.
  const expandedRef = useRef(false)

  // Diukur di ref callback (bukan useEffect) — lint `react-hooks/set-state-in-effect` melarang
  // setState di dalam efek. ResizeObserver menangani perubahan lebar layar & muat font.
  const measureRef = useCallback((node: HTMLParagraphElement | null) => {
    if (!node) return

    const check = () => {
      if (expandedRef.current) return
      setOverflowing(node.scrollHeight - node.clientHeight > 1)
    }

    check()
    const observer = new ResizeObserver(check)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  function toggle() {
    expandedRef.current = !expanded
    setExpanded((v) => !v)
  }

  return (
    <section className="bg-white px-4 py-4">
      <h2 className="mb-2 text-sm font-bold text-zinc-800">Deskripsi Produk</h2>

      {/* Pembungkus relative: tempat menempelkan gradient fade di tepi bawah teks terpotong */}
      <div className="relative">
        <p
          ref={measureRef}
          style={{ maxHeight: expanded ? EXPANDED_MAX_HEIGHT : COLLAPSED_MAX_HEIGHT }}
          className="overflow-hidden whitespace-pre-line text-sm leading-relaxed text-zinc-600 transition-[max-height] duration-300 ease-in-out"
        >
          {description}
        </p>

        {/* Fade putih (senada latar section) sebagai sinyal masih ada lanjutan.
            pointer-events-none supaya tidak menghalangi seleksi teks di baris terakhir. */}
        {!expanded && overflowing && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-white"
          />
        )}
      </div>

      {/* Tombol disembunyikan bila deskripsi memang muat 5 baris — tak ada yang perlu dibuka */}
      {overflowing && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-2 text-sm font-semibold text-brand-primary transition hover:brightness-90"
        >
          {expanded ? 'Sembunyikan' : 'Lihat Selengkapnya'}
        </button>
      )}
    </section>
  )
}
