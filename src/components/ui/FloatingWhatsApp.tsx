'use client'

// src/components/ui/FloatingWhatsApp.tsx
// Tombol WhatsApp mengambang (floating) di pojok KANAN BAWAH, tampil di semua halaman e-commerce
// (disembunyikan di area /oms). Menampilkan bubble ajakan "Pesan melalui CS kami" beberapa detik
// setelah halaman dimuat (bisa ditutup manual). Client Component: butuh pathname, timer, & state.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'

// TODO: Ganti dengan link WhatsApp CS resmi setelah tersedia.
// Format nantinya: https://wa.me/62xxxxxxxxxx?text=Halo%2C%20saya%20ingin%20bertanya%20tentang%20produk
// Sementara diarahkan ke halaman 404 (JANGAN pakai nomor dummy yang terlihat asli).
const WHATSAPP_CS_LINK = '/404'

// Teks bubble ajakan
const BUBBLE_TEXT = 'Pesan melalui CS kami'
const SHOW_DELAY = 2500 // ms sebelum bubble muncul
const AUTO_HIDE = 9000 // ms bubble otomatis tersembunyi (bukan ditutup permanen)

// Tombol WhatsApp mengambang + bubble ajakan. Mengembalikan null di area OMS.
export default function FloatingWhatsApp() {
  const pathname = usePathname()

  const [visible, setVisible] = useState(false) // bubble sedang tampil?
  const [dismissed, setDismissed] = useState(false) // user menutup bubble secara manual?

  // Munculkan bubble setelah delay, lalu sembunyikan otomatis. Berhenti bila sudah ditutup manual.
  useEffect(() => {
    if (dismissed) return
    const showTimer = setTimeout(() => setVisible(true), SHOW_DELAY)
    const hideTimer = setTimeout(() => setVisible(false), AUTO_HIDE)
    return () => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
    }
  }, [dismissed])

  // Jangan tampilkan di area admin/OMS.
  if (pathname?.startsWith('/oms')) return null

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex items-end gap-2">
      {/* Bubble ajakan (kiri tombol) — fade/slide; tetap ter-mount (untuk transisi) selama belum ditutup */}
      {!dismissed && (
        <div
          className={`relative mb-1 max-w-[200px] rounded-2xl rounded-br-sm border border-zinc-100 bg-white px-3 py-2 pl-7 shadow-lg transition-all duration-300 ease-out ${
            visible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'
          }`}
        >
          <p className="text-sm leading-snug text-zinc-700">{BUBBLE_TEXT}</p>
          {/* Tutup bubble secara permanen */}
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => {
              setVisible(false)
              setDismissed(true)
            }}
            className="absolute left-1 top-1 rounded-full p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tombol lingkaran hijau + ikon WhatsApp */}
      <a
        href={WHATSAPP_CS_LINK}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Hubungi CS via WhatsApp"
        onClick={() => setVisible(false)}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white shadow-lg transition hover:scale-105 hover:brightness-95 active:scale-95"
      >
        <WhatsAppIcon />
      </a>
    </div>
  )
}

// Ikon WhatsApp (SVG resmi) — lucide-react tak menyediakan ikon brand ini, jadi inline SVG
// (tanpa menambah dependency icon baru, sesuai aturan CLAUDE.md).
function WhatsAppIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.548 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488" />
    </svg>
  )
}
