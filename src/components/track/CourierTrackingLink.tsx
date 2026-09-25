'use client'

// src/components/track/CourierTrackingLink.tsx
// Ajakan melacak di situs kurir: nomor resi + tombol salin + tautan keluar.
//
// Ditampilkan selama riwayat scan belum bisa kita tarik sendiri (lihat lib/courier-tracking-url.ts).
//
// 'use client' HANYA karena tombol salin butuh `navigator.clipboard`. Nomor resi tetap dirender di
// server sebagai teks, jadi pembeli bisa menyalinnya manual walau JavaScript gagal dimuat.

import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'

export default function CourierTrackingLink({
  trackingNumber,
  courierName,
  trackingUrl,
}: {
  trackingNumber: string
  // Nama kurir untuk teks tombol, mis. 'J&T'
  courierName: string
  // null → hanya nomor resi + tombol salin, tanpa tautan (kurir belum punya pola URL)
  trackingUrl: string | null
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(trackingNumber)
      setCopied(true)
      // Kembali ke keadaan awal supaya tombolnya bisa dipakai lagi tanpa memuat ulang halaman
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard ditolak (izin/konteks tak aman) → biarkan; nomornya tetap terlihat & bisa
      // diseleksi manual. Menampilkan pesan galat untuk hal sekecil ini hanya menambah kebisingan.
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs text-zinc-500">Nomor Resi</p>
      <div className="mt-1 flex items-center gap-2">
        {/* select-all: satu klik menyeleksi seluruh nomor — jalan keluar bila clipboard ditolak */}
        <code className="min-w-0 flex-1 select-all break-all font-mono text-sm font-semibold text-zinc-900">
          {trackingNumber}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Salin nomor resi"
          className="flex flex-none items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 active:scale-95"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-brand-primary" />
              Tersalin
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Salin
            </>
          )}
        </button>
      </div>

      {trackingUrl && (
        <a
          href={trackingUrl}
          target="_blank"
          // noreferrer menyertai noopener: situs kurir tak perlu tahu halaman mana yang merujuknya,
          // dan URL kita memuat nomor invoice pesanan.
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-brand-primary py-2.5 text-sm font-semibold text-white transition hover:brightness-90 active:scale-[0.99]"
        >
          Lacak di {courierName}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  )
}
