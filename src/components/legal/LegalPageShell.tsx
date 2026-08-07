// src/components/legal/LegalPageShell.tsx
// Kerangka halaman dokumen legal (Kebijakan Privasi & Syarat/Ketentuan).
// Server Component — isinya statis. Menyediakan: header hijau brand + tombol kembali (pola sama
// dengan /pesanan-saya), judul, tanggal berlaku, daftar isi anchor, lalu konten dokumen.
// Dipakai dua halaman agar gaya & struktur keduanya identik.

import Link from 'next/link'
import Image from 'next/image'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/data/legal'

// Satu entri daftar isi — `id` harus sama dengan id `<LegalSection>` yang dituju
export type LegalTocItem = {
  id: string
  label: string
}

// Membungkus dokumen legal: header, judul, daftar isi, dan konten.
export default function LegalPageShell({
  title,
  intro,
  toc,
  children,
}: {
  title: string
  intro: string
  toc: LegalTocItem[]
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface pt-14 text-zinc-900">
      {/* Header hijau brand + tombol kembali (konsisten dengan halaman /pesanan-saya) */}
      <header className="fixed inset-x-0 top-0 z-50 rounded-b-[2rem] bg-brand-header/90 text-white shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/" aria-label="Kembali ke beranda" className="rounded-md p-1 transition active:scale-95">
            <BackIcon />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo-infarm.png" alt="Logo Infarm" width={32} height={32} priority unoptimized className="h-8 w-auto object-contain" />
            <span className="text-lg font-bold tracking-tight sm:text-xl">infarm</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-zinc-900 sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">Terakhir diperbarui: {LEGAL_EFFECTIVE_DATE}</p>
        <p className="mt-4 text-sm leading-relaxed text-zinc-700">{intro}</p>

        {/* Daftar isi — anchor ke tiap section di bawah */}
        <nav aria-label="Daftar isi" className="mt-6 rounded-2xl border border-brand-light bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Daftar Isi</h2>
          <ol className="mt-3 space-y-1.5">
            {toc.map((item, i) => (
              <li key={item.id} className="flex gap-2 text-sm">
                <span className="shrink-0 font-bold text-brand-primary">{i + 1}.</span>
                <a href={`#${item.id}`} className="text-zinc-700 underline decoration-brand-light underline-offset-2 transition hover:text-brand-primary">
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-6 space-y-4">{children}</div>
      </main>
    </div>
  )
}

// Satu bab dokumen. `id` dipakai sebagai target anchor dari daftar isi.
// `scroll-mt-16` supaya judul tidak tertutup header fixed saat di-anchor.
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-16 rounded-2xl border border-brand-light bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-700">{children}</div>
    </section>
  )
}

// Daftar berpoin dengan bullet hijau brand (dipakai berulang di kedua dokumen)
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  )
}

// Tautan keluar (kebijakan pihak ketiga) — selalu tab baru + rel aman
export function LegalExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-brand-primary underline decoration-brand-light underline-offset-2 transition hover:brightness-90"
    >
      {children}
    </a>
  )
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
