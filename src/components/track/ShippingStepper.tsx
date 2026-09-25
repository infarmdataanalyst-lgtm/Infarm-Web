// src/components/track/ShippingStepper.tsx
// Stepper horizontal 4 tahap status pengiriman: Pesanan Dibuat → Diproses → Dikirim → Sampai Tujuan.
// Tahap sudah lewat: ikon centang hijau. Tahap saat ini: ikon tahap hijau. Tahap belum: abu-abu.
// Warna mengikuti tema brand (brand-primary hijau). Server Component (murni tampilan).

import { Check, ClipboardList, Package, Truck, MapPin, type LucideIcon } from 'lucide-react'
import { SHIPPING_STEPS, type ShippingStepKey } from '@/lib/tracking'

// Ikon per tahap
const STEP_ICONS: Record<ShippingStepKey, LucideIcon> = {
  created: ClipboardList,
  processing: Package,
  shipped: Truck,
  arrived: MapPin,
}

// Menampilkan stepper. currentIndex = tahap saat ini (0..SHIPPING_STEPS.length-1).
// Jumlah tahap & lebar kolom mengikuti SHIPPING_STEPS: tiap <li> memakai flex-1 sehingga garis
// penghubung otomatis proporsional saat jumlah tahap berubah — tak ada lebar yang di-hardcode.
export default function ShippingStepper({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="flex items-start">
      {SHIPPING_STEPS.map((step, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        const active = done || current // hijau bila sudah/lagi berlangsung
        const Icon = STEP_ICONS[step.key]
        const isFirst = i === 0
        const isLast = i === SHIPPING_STEPS.length - 1

        return (
          <li key={step.key} className="flex flex-1 flex-col items-center">
            {/* Baris ikon + garis penghubung ke tahap sebelumnya */}
            <div className="flex w-full items-center">
              {/* Garis kiri. Hijau bila tahap ini sudah/berlangsung.
                  Pada tahap PERTAMA garisnya tetap dirender tapi `invisible` — bukan dihilangkan.
                  Kalau elemennya dibuang, ikon terdorong ke tepi kolom sementara labelnya tetap
                  rata-tengah selebar kolom, sehingga teks tak lagi sejajar dengan ikonnya (paling
                  kentara di tahap pertama & terakhir). Menyisakan ruangnya membuat ikon selalu
                  berada di tengah kolom. */}
              <span
                className={`h-0.5 flex-1 ${
                  isFirst ? 'invisible' : active ? 'bg-brand-primary' : 'bg-gray-200'
                }`}
                aria-hidden
              />

              {/* Lingkaran ikon */}
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  active ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-400'
                }`}
                aria-hidden
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>

              {/* Garis kanan. Hijau bila tahap BERIKUTNYA sudah tercapai.
                  Pada tahap TERAKHIR juga `invisible`, dengan alasan yang sama seperti garis kiri. */}
              <span
                className={`h-0.5 flex-1 ${
                  isLast ? 'invisible' : i < currentIndex ? 'bg-brand-primary' : 'bg-gray-200'
                }`}
                aria-hidden
              />
            </div>

            {/* Label tahap */}
            <span
              className={`mt-2 px-1 text-center text-[11px] leading-tight ${
                active ? 'font-semibold text-brand-primary' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
