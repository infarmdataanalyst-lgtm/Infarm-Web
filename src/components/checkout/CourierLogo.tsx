'use client'

// src/components/checkout/CourierLogo.tsx
// Kotak logo kurir. Dipakai di baris trigger "Metode Pengiriman" dan di setiap opsi pada
// bottom sheet "Pilih Kurir Pengiriman".
//
// Kenapa komponen tersendiri, bukan <Image> inline: aturan tampilannya sama di semua tempat
// (kotak putih, object-contain, fallback ikon truk) dan hanya ukurannya yang berbeda. Menaruhnya
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

// Kelas kotak + ukuran ikon fallback + hint `sizes` untuk next/image, per ukuran.
const SIZES: Record<Size, { box: string; icon: string; sizes: string }> = {
  sm: { box: 'h-9 w-9', icon: 'h-5 w-5', sizes: '36px' },
  md: { box: 'h-11 w-11', icon: 'h-6 w-6', sizes: '44px' },
}

// Menampilkan logo kurir dalam kotak putih berukuran tetap.
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

  // Kotak SELALU putih dengan border tipis, termasuk saat kartu opsi sedang aktif (latarnya
  // brand-surface hijau muda). Logo kurir umumnya PNG transparan berwarna gelap; membiarkannya
  // duduk langsung di atas latar hijau membuatnya kotor dan menempel ke ring hijau penanda pilihan.
  const shell = `relative ${box} flex flex-none items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white`

  if (!src || failed) {
    return (
      <span className={shell} aria-hidden>
        <Truck className={`${icon} text-brand-primary`} />
      </span>
    )
  }

  return (
    <span className={shell}>
      {/* p-1 memberi ruang bernapas supaya logo tak menyentuh border kotak.
          unoptimized mengikuti pola aset lokal lain di project (lihat public/images/icons). */}
      <Image
        src={src}
        alt={`Logo ${name}`}
        fill
        unoptimized
        sizes={sizes}
        onError={() => setFailed(true)}
        className="object-contain p-1"
      />
    </span>
  )
}
