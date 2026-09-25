// src/components/track/TrackingDetail.tsx
// Section "Detail Pelacakan" di halaman Lacak Pesanan — peristiwa perjalanan paket dari Mengantar.
//
// Server Component (murni tampilan). Pemanggilan API dilakukan di `src/app/track/page.tsx` dan
// hasilnya diturunkan ke sini sebagai prop, karena STEPPER juga membutuhkan peristiwa yang sama —
// mengambilnya dua kali (server untuk stepper, klien untuk daftar) berarti dua panggilan Mengantar
// untuk satu halaman.
//
// Konsekuensi yang disengaja: tak ada spinner. Halaman dirender setelah data siap, dan panggilan
// tracking dibatasi timeout 4 detik + cache 10 menit supaya keterlambatannya tak terasa. Keadaan
// gagal & kosong tetap ditampilkan eksplisit, hanya "sedang memuat" yang tak pernah terlihat.

import { AlertTriangle, Check, PackageSearch } from 'lucide-react'
import type { TrackingEvent, TrackingFailureReason } from '@/lib/mengantar-tracking'
import { mapCourierEvent } from '@/lib/tracking'
import { courierTrackingUrl } from '@/lib/courier-tracking-url'
import CourierTrackingLink from '@/components/track/CourierTrackingLink'

// Kegagalan yang TIDAK layak ditampilkan sebagai peringatan ke pembeli.
//
// 'bad-shape' = respons Mengantar terbaca tapi tak memuat array peristiwa yang kita kenali. Itu
// keterbatasan di sisi KITA, bukan sesuatu yang bisa ditindaklanjuti pembeli — jadi yang ia lihat
// pesan netral "belum ada update", sementara detail teknisnya tetap tercatat di log server.
// Peringatan oranye permanen menyiratkan ada yang rusak dan mendorong pembeli menghubungi CS untuk
// sesuatu yang tak bisa mereka perbaiki.
const SILENT_FAILURES: TrackingFailureReason[] = ['bad-shape', 'unauthorized', 'not-configured']

// Pesan gagal yang layak dibaca pembeli — hanya untuk gangguan yang mungkin sembuh sendiri.
// Detail teknis tetap hanya di log server.
const FAILURE_MESSAGES: Record<TrackingFailureReason, string> = {
  'not-configured': '',
  'no-awb': 'Nomor resi belum tersedia.',
  'http-error':
    'Detail pelacakan belum bisa diambil dari kurir. Nomor resi mungkin belum aktif — coba lagi beberapa saat lagi.',
  'bad-shape': '',
  unauthorized: '',
  network: 'Gagal menghubungi layanan kurir. Coba muat ulang halaman.',
}

export default function TrackingDetail({
  events,
  failureReason,
  trackingNumber,
  courierName,
}: {
  // Peristiwa terurut TERBARU DI ATAS. Array kosong = resi belum aktif di sistem kurir.
  events: TrackingEvent[]
  // Diisi bila pengambilan gagal; `events` diabaikan saat ini terisi.
  failureReason?: TrackingFailureReason
  // Nomor resi & nama kurir — untuk ajakan melacak di situs kurir. Kosong = pesanan belum ber-resi.
  trackingNumber?: string
  courierName?: string
}) {
  // Kegagalan "senyap" diperlakukan seperti belum ada peristiwa — lihat SILENT_FAILURES.
  const visibleFailure =
    failureReason && !SILENT_FAILURES.includes(failureReason) ? failureReason : undefined

  // Ajakan ke situs kurir ditampilkan selama kita BELUM punya peristiwanya sendiri. Begitu riwayat
  // bisa ditarik (Mengantar membuka endpoint tracking), blok ini otomatis hilang — pembeli tak perlu
  // lagi meninggalkan situs.
  const showCourierLink = events.length === 0 && Boolean(trackingNumber)

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold text-gray-900">Detail Pelacakan</h2>

      {visibleFailure ? (
        <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <p className="leading-relaxed">{FAILURE_MESSAGES[visibleFailure]}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          <PackageSearch className="mt-0.5 h-4 w-4 flex-none text-zinc-400" />
          <p className="leading-relaxed">
            {trackingNumber
              ? 'Riwayat perjalanan paket dilacak langsung di situs kurir. Gunakan nomor resi di bawah.'
              : 'Belum ada update perjalanan. Detail pelacakan akan muncul setelah paket diserahkan ke kurir.'}
          </p>
        </div>
      ) : (
        <ol className="space-y-0">
          {events.map((event, i) => {
            const isLast = i === events.length - 1
            // Terjemahan Bahasa Indonesia dari kosakata kurir (lib/tracking.ts). Teks ASLI tetap
            // ditampilkan kecil di bawahnya — bila pemetaan meleset atau kurir memakai istilah baru,
            // pembeli masih membaca kabar aslinya, bukan tebakan kita.
            const mapped = mapCourierEvent(event.label)
            return (
              <li key={`${event.timestamp}-${event.label}-${i}`} className="flex gap-3">
                {/* Kolom penanda: bulatan centang + garis vertikal ke peristiwa berikutnya.
                    Garis disembunyikan pada baris terakhir supaya tak menggantung di bawah. */}
                <div className="flex flex-col items-center">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-primary text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {!isLast && <span className="w-0.5 flex-1 bg-zinc-200" aria-hidden />}
                </div>

                <div className={isLast ? 'pb-0' : 'pb-4'}>
                  {/* Waktu ditampilkan APA ADANYA dari kurir — tidak diparse ulang. Format waktu
                      kurir belum dipastikan, dan salah parse akan menggeser jam secara meyakinkan
                      tapi salah. */}
                  {event.timestamp && (
                    <p className="text-xs text-gray-400">{event.timestamp}</p>
                  )}
                  <p className="text-sm font-medium leading-snug text-gray-900">
                    {mapped.label ?? event.label}
                  </p>
                  {/* Hanya ditampilkan bila memang ada terjemahannya — kalau tidak, barisnya cuma
                      mengulang judul di atasnya. */}
                  {mapped.label && (
                    <p className="mt-0.5 text-xs leading-snug text-gray-400">{event.label}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {showCourierLink && trackingNumber && (
        <CourierTrackingLink
          trackingNumber={trackingNumber}
          courierName={courierName || 'kurir'}
          trackingUrl={courierTrackingUrl(courierName, trackingNumber)}
        />
      )}
    </section>
  )
}
