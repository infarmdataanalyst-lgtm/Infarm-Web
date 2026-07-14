// src/components/track/ShippingStepper.tsx
// Stepper horizontal 5 tahap status pengiriman (Pesanan Dibuat → ... → Sampai Tujuan).
// Tahap sudah lewat: ikon centang hijau. Tahap saat ini: ikon tahap hijau. Tahap belum: abu-abu.
// Warna mengikuti tema brand (brand-primary hijau). Server Component (murni tampilan).

import { Check, ClipboardList, Package, Truck, Bike, MapPin, type LucideIcon } from 'lucide-react'
import { SHIPPING_STEPS, type ShippingStepKey } from '@/lib/tracking'

// Ikon per tahap
const STEP_ICONS: Record<ShippingStepKey, LucideIcon> = {
  created: ClipboardList,
  processing: Package,
  shipped: Truck,
  delivering: Bike,
  arrived: MapPin,
}

// Menampilkan stepper 5 tahap. currentIndex = tahap saat ini (0..4).
export default function ShippingStepper({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="flex items-start">
      {SHIPPING_STEPS.map((step, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        const active = done || current // hijau bila sudah/lagi berlangsung
        const Icon = STEP_ICONS[step.key]
        const isFirst = i === 0

        return (
          <li key={step.key} className="flex flex-1 flex-col items-center">
            {/* Baris ikon + garis penghubung ke tahap sebelumnya */}
            <div className="flex w-full items-center">
              {/* Garis kiri (tersembunyi pada tahap pertama). Hijau bila tahap ini sudah/berlangsung. */}
              {!isFirst && (
                <span
                  className={`h-0.5 flex-1 ${active ? 'bg-brand-primary' : 'bg-gray-200'}`}
                  aria-hidden
                />
              )}

              {/* Lingkaran ikon */}
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  active ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-400'
                }`}
                aria-hidden
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>

              {/* Garis kanan (tersembunyi pada tahap terakhir). Hijau bila tahap BERIKUTNYA sudah tercapai. */}
              {i < SHIPPING_STEPS.length - 1 && (
                <span
                  className={`h-0.5 flex-1 ${i < currentIndex ? 'bg-brand-primary' : 'bg-gray-200'}`}
                  aria-hidden
                />
              )}
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
