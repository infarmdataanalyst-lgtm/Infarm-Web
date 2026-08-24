'use client'

// src/components/oms/ProductImagePreview.tsx
// Thumbnail foto produk di modal Edit Produk yang bisa diklik untuk melihat versi besarnya.
// Klik di mana saja (atau Escape) menutup preview.
//
// ── Kenapa komponen tersendiri, bukan state di halaman ──
// Halaman Pesanan/Produk OMS itu satu komponen besar yang juga merender seluruh tabel produk.
// Menaruh state `preview` di sana berarti tiap buka/tutup preview me-render ulang tabel itu juga.
// Dengan state lokal per thumbnail, yang di-render ulang hanya satu sel.
//
// ── Kenapa `unoptimized` dipertahankan ──
// Thumbnail memang sudah mengunduh berkas resolusi penuh (Image Optimization dimatikan di modal
// ini), jadi preview memakai URL yang SAMA dan tak menambah satu pun permintaan jaringan —
// browser mengambilnya dari cache. Menyalakan optimisasi justru memicu transformasi gambar baru
// di Vercel, yang berkuota di plan Hobby.

import { useEffect, useState } from 'react'
import Image from 'next/image'

export default function ProductImagePreview({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false)

  // Escape menutup preview. Listener hanya dipasang saat preview terbuka supaya tak ada handler
  // menganggur untuk tiap thumbnail di grid.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* Tombol pemicu = seluruh area thumbnail. `absolute inset-0` supaya ia mengisi sel grid yang
          sudah `relative`, dan tombol hapus (dirender setelahnya oleh parent) tetap bisa diklik
          karena berada di atasnya dalam urutan DOM. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Lihat ${alt} ukuran penuh`}
        className="absolute inset-0 cursor-zoom-in"
      >
        <Image src={src} alt={alt} fill unoptimized sizes="80px" className="object-cover" />
      </button>

      {open && (
        // z-[70]: modal Edit Produk memakai z-50 dan tombol mengambang storefront z-[60].
        // Apa pun yang menutupi layar dan menerima klik wajib berada di atas keduanya.
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/80 p-6"
        >
          {/* Lapisan penutup selebar layar: klik DI MANA SAJA menutup preview, termasuk pada
              gambarnya sendiri (gambar dirender di atas lapisan ini tapi tak menangkap klik —
              lihat pointer-events-none). */}
          <button
            type="button"
            aria-label="Tutup preview"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-zoom-out"
          />

          {/* Gambar besar. `pointer-events-none` supaya klik menembus ke lapisan penutup di
              belakangnya — tanpa itu, klik tepat di atas gambar tak menutup apa pun dan terasa
              seperti preview yang macet. */}
          <div className="pointer-events-none relative z-10 h-full w-full">
            <Image
              src={src}
              alt={alt}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
              priority
            />
          </div>
        </div>
      )}
    </>
  )
}
