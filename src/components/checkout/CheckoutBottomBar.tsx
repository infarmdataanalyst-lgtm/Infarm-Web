// src/components/checkout/CheckoutBottomBar.tsx
// Bilah bawah sticky checkout: label "Total Pembayaran" + nominal (kiri), tombol "Bayar Sekarang" (kanan),
// plus pemberitahuan persetujuan S&K/Privasi di atas tombol (tautan dibuka di TAB BARU supaya
// isian form checkout tidak hilang).

import Link from 'next/link'
import { formatRupiah } from '@/lib/format'
import { LEGAL_PAGES_ENABLED, PRIVACY_POLICY_PATH, TERMS_PATH } from '@/lib/data/legal'

// Bentuk penyajian bilah bayar.
//   'sticky' — bilah melayang di dasar layar (tampilan mobile, < lg)
//   'panel'  — kartu penutup statis di dalam kolom kanan (tampilan desktop, lg+)
//
// Satu komponen dengan dua bentuk, BUKAN dua komponen: isinya (peringatan minimum belanja,
// pemberitahuan S&K, total, tombol) harus tetap identik di kedua tampilan. Menggandakan
// komponennya berarti dua tempat yang bisa berbeda diam-diam saat salah satunya diperbarui.
export type CheckoutBarVariant = 'sticky' | 'panel'

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
  variant = 'sticky',
}: {
  total: number
  onPay: () => void
  isPaying?: boolean
  canPay?: boolean
  minOrderAmount?: number // batas minimum belanja dari pengaturan toko
  minOrderShortfall?: number // kekurangan menuju batas itu (0 = sudah terpenuhi)
  variant?: CheckoutBarVariant
}) {
  // Redup saat belum boleh bayar (dan tidak sedang memproses)
  const dimmed = !canPay && !isPaying
  const isPanel = variant === 'panel'

  // Pembungkus luar. Varian sticky disembunyikan di lg+ (digantikan kartu di kolom kanan), dan
  // sebaliknya — keduanya dirender bersamaan, hanya salah satu yang tampak per ukuran layar.
  const shell = isPanel
    ? 'hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:block'
    : 'fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white lg:hidden'

  // Varian sticky membatasi lebar isinya sendiri (ia selebar layar); varian panel sudah dibatasi
  // oleh kolomnya, jadi pembatas lebar di dalamnya justru membuat isi mengambang di tengah kartu.
  const inner = isPanel ? 'px-4' : 'mx-auto max-w-6xl px-4'

  return (
    <div className={shell}>
      {/* Minimum belanja belum tercapai → jelaskan kekurangannya, tombol bayar dikunci */}
      {minOrderShortfall > 0 && (
        <p className={`${inner} pt-2 text-xs leading-snug text-orange-700`}>
          Minimal belanja {formatRupiah(minOrderAmount)}, tambah {formatRupiah(minOrderShortfall)} lagi
          untuk checkout.
        </p>
      )}

      {/* Pemberitahuan persetujuan — tautan target="_blank" agar isian checkout tetap utuh.
          Seluruh pemberitahuan disembunyikan saat halaman legal nonaktif: meminta pembeli
          menyetujui dokumen yang tak bisa ia baca justru lebih buruk daripada tak menyebutnya. */}
      {LEGAL_PAGES_ENABLED && (
        <p className={`${inner} pt-2 text-[11px] leading-snug text-zinc-500`}>
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
      )}

      {/* Panel: total di atas, tombol selebar kartu di bawahnya — kartu ini penutup alur di kolom
          kanan, jadi tombolnya perlu berbobot. Sticky: berdampingan agar bilahnya tetap tipis dan
          tak memakan tinggi layar mobile. */}
      <div
        className={`${inner} pb-3 pt-2 ${
          isPanel ? 'space-y-3 pb-4' : 'flex items-center gap-3'
        }`}
      >
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">Total Pembayaran</p>
          <p className="truncate text-lg font-bold text-brand-primary">{formatRupiah(total)}</p>
        </div>

        <button
          type="button"
          onClick={onPay}
          disabled={isPaying}
          aria-disabled={!canPay}
          className={`shrink-0 rounded-xl bg-brand-primary py-3 font-heading text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${
            isPanel ? 'w-full px-4' : 'ml-auto px-8'
          } ${dimmed ? 'cursor-not-allowed opacity-60' : 'hover:brightness-90'}`}
        >
          {isPaying ? 'Memproses…' : 'Bayar Sekarang'}
        </button>
      </div>
    </div>
  )
}
