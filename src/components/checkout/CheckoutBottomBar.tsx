// src/components/checkout/CheckoutBottomBar.tsx
// Bilah bawah sticky checkout: label "Total Pembayaran" + nominal (kiri), tombol "Bayar Sekarang" (kanan).

import { formatRupiah } from '@/lib/format'

// Menampilkan total pembayaran & tombol bayar; total diberikan dari parent (reaktif).
// isPaying: saat true tombol dinonaktifkan & berubah jadi "Memproses…" (cegah double submit).
// canPay: saat false tombol tampak redup (alamat belum valid). Tetap bisa diklik agar guard
// di handler bisa menampilkan pesan — jadi tidak hanya mengandalkan atribut disabled.
export default function CheckoutBottomBar({
  total,
  onPay,
  isPaying = false,
  canPay = true,
}: {
  total: number
  onPay: () => void
  isPaying?: boolean
  canPay?: boolean
}) {
  // Redup saat belum boleh bayar (dan tidak sedang memproses)
  const dimmed = !canPay && !isPaying

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">Total Pembayaran</p>
          <p className="truncate text-lg font-bold text-brand-primary">{formatRupiah(total)}</p>
        </div>

        <button
          type="button"
          onClick={onPay}
          disabled={isPaying}
          aria-disabled={!canPay}
          className={`ml-auto shrink-0 rounded-xl bg-brand-primary px-8 py-3 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
            dimmed ? 'cursor-not-allowed opacity-60' : 'hover:brightness-90'
          }`}
        >
          {isPaying ? 'Memproses…' : 'Bayar Sekarang'}
        </button>
      </div>
    </div>
  )
}
