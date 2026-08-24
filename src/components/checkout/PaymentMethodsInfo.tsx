'use client'

// src/components/checkout/PaymentMethodsInfo.tsx
// Seksi "Metode Pembayaran" di halaman checkout — INFORMASI, bukan pilihan.
//
// Menggantikan baris OptionRow + bottom sheet PaymentModal. Alasannya: metode sebenarnya dipilih
// di halaman Xendit setelah pembeli diarahkan ke sana, jadi pemilih di checkout hanya membuat
// pembeli memilih dua kali dan yang pertama tak berpengaruh apa pun.
//
// 'use client' karena butuh `onError` pada logo: file PNG-nya bisa belum diunggah, dan pembeli tak
// boleh melihat gambar rusak. Pola sama dengan CourierLogo.

import { useState } from 'react'
import Image from 'next/image'
import { Wallet } from 'lucide-react'
import { PAYMENT_METHOD_GROUPS, paymentLogoSrc, type PaymentLogo } from '@/lib/payment-methods'

// Menampilkan daftar metode pembayaran yang tersedia beserta logonya.
export default function PaymentMethodsInfo() {
  return (
    <section className="bg-white px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-brand-primary">
          <Wallet className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-800">Metode Pembayaran</p>
          <p className="text-xs text-zinc-500">Dipilih pada halaman pembayaran setelah ini</p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-zinc-100 border-t border-zinc-100">
        {PAYMENT_METHOD_GROUPS.map((group) => (
          <li key={group.id} className="py-3">
            <p className="text-sm font-semibold text-zinc-800">{group.title}</p>

            {/* Logo langsung di bawah judulnya, bukan di kanan. `flex-wrap` supaya kelompok berlogo
                banyak (Virtual Account) turun baris di kolom sempit alih-alih menggepengkan
                logonya. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {group.logos.map((logo) => (
                <PaymentLogoBox key={`${group.id}-${logo.slug}`} logo={logo} />
              ))}
              {group.more && (
                <span className="ml-0.5 text-[11px] leading-tight text-zinc-400">{group.more}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Kotak logo satu penyedia. Jatuh ke teks nama bila filenya belum ada di public/images/payments/ —
// lebih berguna daripada kotak kosong, dan membuat daftar tetap terbaca sebelum semua PNG diunggah.
function PaymentLogoBox({ logo }: { logo: PaymentLogo }) {
  const [failed, setFailed] = useState(false)

  // Kotak SELALU putih: logo penyedia pembayaran umumnya PNG transparan berwarna gelap.
  const shell =
    'relative flex h-7 flex-none items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white'

  if (failed) {
    return (
      <span className={`${shell} px-1.5 text-[10px] font-semibold text-zinc-500`}>
        {logo.label}
      </span>
    )
  }

  return (
    <span className={`${shell} w-11`}>
      <Image
        src={paymentLogoSrc(logo.slug)}
        alt={`Logo ${logo.label}`}
        fill
        unoptimized
        sizes="44px"
        onError={() => setFailed(true)}
        className="object-contain p-0.5"
      />
    </span>
  )
}
