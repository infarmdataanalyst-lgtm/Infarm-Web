'use client'

// src/components/home/FooterHomeLink.tsx
// Tautan "Home" di footer. Footer hanya tampil di beranda, jadi tautan ke "/" diklik dari halaman
// yang SAMA — dan <Link> Next.js ke URL yang sedang dibuka tidak menggulir ke atas: pembeli
// menekan "Home" dan tak terjadi apa-apa. Di beranda, klik diganti gulir halus ke paling atas;
// di halaman lain (bila footer kelak dipasang di sana) tetap navigasi biasa ke beranda.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

export default function FooterHomeLink({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const pathname = usePathname()

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== '/') return
    e.preventDefault()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <Link href="/" onClick={handleClick} className={className}>
      {children}
    </Link>
  )
}
