// src/components/checkout/CheckoutBottomBar.tsx
// Bilah bawah sticky checkout: label "Total Pembayaran" + nominal (kiri), tombol "Bayar Sekarang" (kanan),
// plus pemberitahuan persetujuan S&K/Privasi di atas tombol (tautan dibuka di TAB BARU supaya
// isian form checkout tidak hilang).

import Link from 'next/link'
import { formatRupiah } from '@/lib/format'
import { PRIVACY_POLICY_PATH, TERMS_PATH } from '@/lib/data/legal'

// Menampilkan total pembayaran & tombol bayar; total diberikan dari parent (reaktif).
// isPaying: saat true tombol dinonaktifkan & berubah jadi "Memproses…" (cegah double submit).
// canPay: saat false tombol tampak redup (alamat belum valid). Tetap bisa diklik agar guard
// di handler bisa menampilkan pesan — jadi tidak hanya mengandalkan atribut disabled.
export default function CheckoutBottomBar({
  total,
  onPay,
  isPaying = false,
  canPay = true,
  minOrderAmount = 0,
  minOrderShortfall = 0,
}: {
  total: number
  onPay: () => void
  isPaying?: boolean
  canPay?: boolean
  minOrderAmount?: number // batas minimum belanja dari pengaturan toko
  minOrderShortfall?: number // kekurangan menuju batas itu (0 = sudah terpenuhi)
}) {
  // Redup saat belum boleh bayar (dan tidak sedang memproses)
  const dimmed = !canPay && !isPaying

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white">
      {/* Minimum belanja belum tercapai → jelaskan kekurangannya, tombol bayar dikunci */}
      {minOrderShortfall > 0 && (
        <p className="mx-auto max-w-6xl px-4 pt-2 text-xs leading-snug text-orange-700">
          Minimal belanja {formatRupiah(minOrderAmount)}, tambah {formatRupiah(minOrderShortfall)} lagi
          untuk checkout.
        </p>
      )}

      {/* Pemberitahuan persetujuan — tautan target="_blank" agar isian checkout tetap utuh */}
      <p className="mx-auto max-w-6xl px-4 pt-2 text-[11px] leading-snug text-zinc-500">
        Dengan melanjutkan pembayaran, Anda menyetujui{' '}
        <Link
          href={TERMS_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-primary underline decoration-brand-light underline-offset-2"
        >
          Syarat &amp; Ketentuan
        </Link>{' '}
        dan{' '}
        <Link
          href={PRIVACY_POLICY_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-primary underline decoration-brand-light underline-offset-2"
        >
          Kebijakan Privasi
        </Link>{' '}
        kami.
      </p>

      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-3 pt-2">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">Total Pembayaran</p>
          <p className="truncate text-lg font-bold text-brand-primary">{formatRupiah(total)}</p>
        </div>

        <button
          type="button"
          onClick={onPay}
          disabled={isPaying}
          aria-disabled={!canPay}
          className={`ml-auto shrink-0 rounded-xl bg-brand-primary px-8 py-3 font-heading text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
            dimmed ? 'cursor-not-allowed opacity-60' : 'hover:brightness-90'
          }`}
        >
          {isPaying ? 'Memproses…' : 'Bayar Sekarang'}
        </button>
      </div>
    </div>
  )
}
