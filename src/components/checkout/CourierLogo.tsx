'use client'

// src/components/checkout/CourierLogo.tsx
// Kotak logo kurir. Dipakai di baris trigger "Metode Pengiriman" dan di setiap opsi pada
// bottom sheet "Pilih Kurir Pengiriman".
//
// Kenapa komponen tersendiri, bukan <Image> inline: aturan tampilannya sama di semua tempat
// (area logo, object-contain, fallback ikon truk) dan hanya ukurannya yang berbeda. Menaruhnya
// di satu tempat berarti menambah kurir baru tak pernah memerlukan penyesuaian gaya.
//
// 'use client' karena butuh `onError`: file logo bisa belum ada di public/images/couriers/
// (mis. kurir baru didaftarkan di courier-logo.ts sebelum PNG-nya diunggah). Tanpa penanganan itu
// pembeli melihat gambar rusak; dengan ini ia otomatis jatuh ke ikon truk.

import { useState } from 'react'
import Image from 'next/image'
import { Truck } from 'lucide-react'
import { courierLogoSrc } from '@/lib/courier-logo'

// Ukuran kotak. 'sm' untuk baris trigger, 'md' untuk kartu opsi di dalam sheet.
type Size = 'sm' | 'md'

// Kelas area + ukuran ikon fallback + hint `sizes` untuk next/image, per ukuran.
//
// Area MELEBAR, bukan bujur sangkar: logo kurir memanjang (J&T ±4:1, SPX ±2,4:1), dan kotak
// persegi membuat logo J&T tinggal setipis garis. Lebarnya sama untuk semua kurir supaya nama
// kurir di sebelahnya tetap sejajar.
//
// Di bawah `lg` (batas mobile/desktop seluruh halaman checkout) area logo 25% lebih kecil —
// permintaan pemilik 2026-10-05: logo terlalu dominan di layar ponsel. Ukuran desktop tak berubah.
const SIZES: Record<Size, { box: string; icon: string; sizes: string }> = {
  sm: { box: 'h-6 w-15 lg:h-8 lg:w-20', icon: 'h-5 w-5', sizes: '(min-width: 1024px) 80px, 60px' },
  md: { box: 'h-7.5 w-18 lg:h-10 lg:w-24', icon: 'h-6 w-6', sizes: '(min-width: 1024px) 96px, 72px' },
}

// Menampilkan logo kurir di area berukuran tetap.
// `courier` menerima kode ('JT') maupun nama ('J&T') — lihat lib/courier-logo.ts.
export default function CourierLogo({
  courier,
  label,
  size = 'md',
}: {
  courier: string | null | undefined
  // Nama yang enak dibaca untuk alt text, mis. 'J&T'. Kosong → pakai `courier`.
  label?: string
  size?: Size
}) {
  const [failed, setFailed] = useState(false)
  const src = courierLogoSrc(courier)
  const name = label || courier || 'kurir'
  const { box, icon, sizes } = SIZES[size]

  // TANPA kotak putih & border sejak 2026-10-02 (permintaan pemilik: "hanya logo saja"). Logo
  // duduk langsung di latar kartu, termasuk hijau muda saat terpilih — karena itu file PNG-nya
  // WAJIB transparan dan dipotong pas ke tepi logo (lihat public/images/couriers/README.md).
  const shell = `relative ${box} flex flex-none items-center justify-center`

  if (!src || failed) {
    return (
      <span className={shell} aria-hidden>
        <Truck className={`${icon} text-brand-primary`} />
      </span>
    )
  }

  return (
    <span className={shell}>
      {/* object-left: logo rata kiri, sejajar dengan tepi kiri kartu.
          unoptimized mengikuti pola aset lokal lain di project (lihat public/images/icons). */}
      <Image
        src={src}
        alt={`Logo ${name}`}
        fill
        unoptimized
        sizes={sizes}
        onError={() => setFailed(true)}
        className="object-contain object-left"
      />
    </span>
  )
}
