// src/components/track/TrackingTimeline.tsx
// Linimasa vertikal riwayat perjalanan. Titik terbaru (indeks 0) hijau dengan ikon centang;
// entri lama di bawahnya abu-abu redup, dihubungkan garis vertikal halus.
// Sumber data: generateTrackingHistory(order) di src/lib/tracking.ts.

import type { TrackingHistoryEntry } from '@/lib/tracking'

type TrackingTimelineProps = {
  events: TrackingHistoryEntry[] // diurutkan terbaru di indeks 0
}

// Menampilkan riwayat status sebagai linimasa vertikal (terbaru di atas).
export default function TrackingTimeline({ events }: TrackingTimelineProps) {
  return (
    <ol className="relative">
      {events.map((event, index) => {
        const isLatest = index === 0
        const isLast = index === events.length - 1

        return (
          <li key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Garis vertikal penghubung (disembunyikan pada titik terakhir) */}
            {!isLast && (
              <span
                className="absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px bg-gray-200"
                aria-hidden
              />
            )}

            {/* Titik status: hijau + centang bila terbaru, abu-abu redup bila lama */}
            <span
              className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                isLatest ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}
              aria-hidden
            >
              {isLatest ? (
                <CheckIcon />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>

            {/* Konten: jam & tanggal · judul status · keterangan lokasi */}
            <div className={isLatest ? 'text-gray-900' : 'text-gray-400'}>
              <p className={`text-xs ${isLatest ? 'text-emerald-600' : 'text-gray-400'}`}>
                {event.timestamp}
              </p>
              <h3 className={`mt-0.5 text-sm font-semibold ${isLatest ? 'text-emerald-600' : 'text-gray-500'}`}>
                {event.title}
              </h3>
              <p className="mt-0.5 text-sm text-gray-500">{event.description}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Ikon centang kecil di dalam titik status terbaru
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
