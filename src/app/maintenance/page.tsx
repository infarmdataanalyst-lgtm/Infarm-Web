// src/app/maintenance/page.tsx
// Halaman "sedang dalam perbaikan". Server Component, konten statis, TANPA header/footer/navigasi —
// selama maintenance tidak ada halaman lain yang layak dituju, jadi satu-satunya elemen interaktif
// adalah tautan CS WhatsApp.
//
// Halaman ini hanya TAMPILAN. Mengalihkan seluruh trafik ke sini saat maintenance dilakukan di
// `src/proxy.ts` (rewrite ber-flag env) — belum diaktifkan; lihat catatan di CLAUDE.md.

import type { Metadata } from 'next'
import Image from 'next/image'
import { Wrench } from 'lucide-react'
import { WHATSAPP_CS_LINK } from '@/lib/data/contact'

export const metadata: Metadata = {
  title: 'Sedang Dalam Perbaikan — infarm.id',
  description:
    'infarm.id sedang dalam perbaikan singkat untuk pengalaman belanja yang lebih baik. Kami segera kembali.',
  // Jangan diindeks: halaman ini kondisi sementara, bukan konten yang mau muncul di hasil pencarian.
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  const year = new Date().getFullYear()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-surface px-6 py-12 text-center text-zinc-900">
      <main className="w-full max-w-md">
        {/* Logo — statis, bukan tautan (tak ada halaman tujuan selama maintenance) */}
        <Image
          src="/images/logo-infarm.png"
          alt="infarm"
          width={56}
          height={56}
          priority
          unoptimized
          className="mx-auto h-14 w-auto object-contain"
        />

        {/* Ikon perbaikan dalam lingkaran hijau muda — aksen brand, bukan merah seperti referensi */}
        <span className="mx-auto mt-10 flex h-20 w-20 items-center justify-center rounded-full bg-brand-light/30 text-brand-primary">
          <Wrench className="h-9 w-9" aria-hidden />
        </span>

        <h1 className="mt-8 text-2xl font-bold leading-tight text-zinc-900 sm:text-3xl">
          Sedang Dalam Perbaikan
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-zinc-600 sm:text-base">
          Kami sedang berbenah sebentar untuk membuat pengalaman belanjamu lebih baik. infarm akan
          segera kembali.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 sm:text-base">
          Terima kasih sudah menunggu.
        </p>

        {/* Pemisah tipis — aksen hijau brand */}
        <span aria-hidden className="mx-auto mt-8 block h-1 w-16 rounded-full bg-brand-primary" />

        <p className="mt-8 text-sm text-zinc-600">
          Butuh bantuan?{' '}
          <a
            href={WHATSAPP_CS_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-brand-primary underline decoration-brand-light underline-offset-4 transition hover:brightness-90"
          >
            Hubungi kami via WhatsApp
          </a>
        </p>
      </main>

      <footer className="mt-16 text-xs text-zinc-400">
        © {year} infarm. Hak Cipta Dilindungi.
      </footer>
    </div>
  )
}
