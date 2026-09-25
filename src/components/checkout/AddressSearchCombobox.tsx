'use client'

// src/components/checkout/AddressSearchCombobox.tsx
// Combobox pencarian alamat ke API Mengantar (lewat proxy /api/mengantar).
// Perilaku: mulai fetch setelah ≥3 karakter, debounce 300ms, tampilkan loading/empty/error,
// dan hasil dalam format "Kelurahan, Kecamatan, Kota, Provinsi". Memanggil onSelect saat dipilih.
// Tanpa dependency eksternal — interaksi ditangani native React.

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, MapPin } from 'lucide-react'
import { searchAddress, toTitleCase, type MengantarAddress } from '@/lib/mengantar'

const MIN_CHARS = 3 // jumlah karakter minimal sebelum mulai mencari

// Jeda sebelum menembak API agar tidak terlalu banyak request.
//
// Diturunkan 500 → 300 (2026-08-24) setelah pengukuran waktu respons Mengantar
// (scripts/mengantar-test/response-time.ts): p95 748ms. Dengan debounce 500ms, jeda yang
// dirasakan pembeli sejak ketikan terakhir sampai daftar muncul mencapai ~1,25 detik — alur
// pengisian alamat terasa putus. 300ms memangkasnya jadi ~1,05 detik tanpa menaikkan beban ke
// Mengantar secara berarti, karena sebagian besar pengulangan kini dijawab cache di bawah.
const DEBOUNCE_MS = 300

// === Cache hasil pencarian (per sesi browser) ===
//
// Di MODUL, bukan di dalam komponen: form checkout bisa remount (ganti layout, buka/tutup panel)
// dan cache yang ikut hilang tiap remount tak ada gunanya.
//
// KENAPA PERLU: data wilayah nyaris tak pernah berubah, sementara pembeli sering mengetik ulang
// kata yang sama — menghapus lalu mengoreksi alamat, atau membandingkan dua kelurahan. Pengukuran
// menunjukkan pemanggilan berulang kata yang sama memang jauh lebih cepat di sisi Mengantar
// (efek cache mereka), tapi tetap menghabiskan satu perjalanan jaringan dan satu jatah rate limit.
//
// Hasil KOSONG ikut disimpan: "tak ada hasil" adalah jawaban yang sah, dan mengulanginya ke server
// setiap kali pembeli mengetik kata yang sama hanya membuang kuota.
// Kegagalan TIDAK disimpan — gangguan sesaat tak boleh terkunci sepanjang sesi.
const addressCache = new Map<string, MengantarAddress[]>()

// Batas entri. Kecil saja: satu sesi checkout wajar menyentuh belasan kata kunci, dan Map yang
// tumbuh tanpa batas di tab yang dibuka berjam-jam adalah kebocoran memori yang tak perlu.
const CACHE_MAX_ENTRIES = 50

function rememberAddresses(keyword: string, data: MengantarAddress[]): void {
  // Entri terlama dibuang lebih dulu (Map mempertahankan urutan penyisipan).
  if (addressCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = addressCache.keys().next().value
    if (oldest !== undefined) addressCache.delete(oldest)
  }
  addressCache.set(keyword, data)
}

// Menampilkan input pencarian alamat + panel hasil. onSelect dipanggil dengan alamat terpilih.
export default function AddressSearchCombobox({
  onSelect,
}: {
  onSelect: (address: MengantarAddress) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MengantarAddress[]>([])
  const [error, setError] = useState('')
  // Keyword yang hasilnya SUDAH selesai (berhasil maupun gagal). Dibanding dengan keyword aktif
  // untuk tahu apakah panel sedang menunggu jawaban.
  //
  // Menyimpan keyword-nya, bukan sekadar penanda boolean seperti sebelumnya: `hasSearched` tak bisa
  // membedakan "sudah dijawab untuk kata ini" dari "sudah dijawab untuk kata sebelumnya", dan
  // itulah yang membuat panel sempat merender daftar KOSONG tanpa spinner selama jeda debounce.
  const [resolvedKeyword, setResolvedKeyword] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const keyword = query.trim()
  const tooShort = keyword.length < MIN_CHARS

  // Perbarui input. Reset hasil saat keyword < minimal ditangani di sini (bukan di effect)
  // agar tidak ada setState sinkron di badan effect.
  function handleChange(value: string) {
    setQuery(value)
    setOpen(true)
    if (value.trim().length < MIN_CHARS) {
      setResults([])
      setError('')
      setResolvedKeyword(null)
    }
  }

  // Hasil dari cache untuk keyword yang sedang diketik.
  //
  // Dibaca saat RENDER, bukan disimpan ke state lewat effect. Dua alasan:
  //   1. Aturan lint proyek melarang setState sinkron di badan effect.
  //   2. Lebih penting — dibaca saat render berarti hasilnya muncul SEKETIKA pada ketikan itu
  //      juga, tanpa menunggu debounce sama sekali. Kalau lewat effect, pembeli tetap menunggu
  //      300ms untuk data yang sebenarnya sudah ada di memori.
  const cached = tooShort ? undefined : addressCache.get(keyword)

  // === Debounce + fetch saat keyword ≥ minimal ===
  useEffect(() => {
    if (keyword.length < MIN_CHARS) return
    // Sudah ada di cache → tak ada yang perlu diambil.
    if (addressCache.has(keyword)) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setError('')
      try {
        const data = await searchAddress(keyword, ctrl.signal)
        if (ctrl.signal.aborted) return
        rememberAddresses(keyword, data)
        setResults(data)
        setResolvedKeyword(keyword)
      } catch (err) {
        if (!ctrl.signal.aborted) {
          // Pesan dari server dipakai bila ada (mis. 429 "terlalu banyak percobaan")
          setError(err instanceof Error ? err.message : 'Gagal mencari alamat. Coba lagi.')
          setResults([])
          // Ditandai selesai juga saat gagal — kalau tidak, panel terjebak menampilkan
          // "Mencari alamat…" selamanya padahal pencariannya sudah berakhir.
          setResolvedKeyword(keyword)
        }
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [keyword])

  // Tutup panel saat klik di luar komponen
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleSelect(address: MengantarAddress) {
    onSelect(address)
    setOpen(false)
  }

  // Panel hasil hanya relevan saat fokus & keyword cukup panjang
  const showPanel = open && !tooShort

  // === Turunan tampilan ===
  //
  // Cache menang atas state: `results` masih berisi jawaban keyword SEBELUMNYA sampai fetch baru
  // selesai, jadi mendahulukannya akan menampilkan hasil yang tak cocok dengan yang diketik.
  const displayed = cached ?? results

  // Sudah ada jawaban untuk keyword INI (dari cache atau dari respons terakhir).
  const answered = cached !== undefined || resolvedKeyword === keyword

  // Sedang menunggu jawaban. Mencakup DUA fase yang sama-sama tak boleh terlihat kosong:
  // jeda debounce (request belum dikirim) dan request yang sedang berjalan.
  //
  // `loading` saja tak cukup — ia baru menyala setelah debounce lewat, sehingga ada ~300ms di mana
  // panel bukan loading, bukan punya hasil, dan bukan "tidak ditemukan". Dulu jendela itu terlihat
  // sebagai kotak putih kosong tanpa penjelasan apa pun.
  const isLoading = !tooShort && !answered

  // Menampilkan hasil lama yang MASIH RELEVAN sambil menunggu yang baru: hanya berlaku bila
  // keyword sekarang adalah perpanjangan keyword yang hasilnya sedang tampil. Kalau tidak, daftar
  // lama justru menyesatkan.
  const showStaleWhileLoading = isLoading && displayed.length > 0

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 transition focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/30">
        <Search className="h-4 w-4 flex-none text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Cari kelurahan, kecamatan, atau kota…"
          className="w-full bg-transparent py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
        />
        {isLoading && <Loader2 className="h-4 w-4 flex-none animate-spin text-brand-primary" />}
      </div>

      {/* Petunjuk minimal karakter */}
      {open && tooShort && keyword.length > 0 && (
        <p className="mt-1 text-xs text-zinc-400">Ketik minimal {MIN_CHARS} karakter untuk mencari.</p>
      )}

      {showPanel && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {error ? (
            <p className="px-3 py-3 text-sm text-red-500">{error}</p>
          ) : isLoading && !showStaleWhileLoading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
              Mencari alamat…
            </p>
          ) : answered && displayed.length === 0 ? (
            // Pesan kosong sengaja MENUNTUN, bukan sekadar memberi tahu.
            //
            // Indeks Mengantar hanya berisi nama kelurahan/kecamatan/kota — terverifikasi lewat uji
            // E2E: "RT 05 RW 02 Kebayoran" tak menghasilkan apa pun, padahal "Kebayoran" saja
            // menghasilkan. Tanpa petunjuk ini, pembeli yang menulis alamat lengkap gaya Indonesia
            // menyimpulkan alamatnya tak dilayani, lalu meninggalkan checkout.
            <div className="px-3 py-3">
              <p className="text-sm text-zinc-600">Alamat tidak ditemukan</p>
              <p className="mt-0.5 text-xs leading-snug text-zinc-400">
                Coba ketik nama kelurahan, kecamatan, atau kota saja — tanpa RT/RW, nama jalan, atau
                nomor rumah.
              </p>
            </div>
          ) : (
            <>
              {/* Pita tipis di atas daftar saat hasil lama masih ditampilkan sambil menunggu yang
                  baru. Daftar dibiarkan terlihat & tetap bisa dipilih — mengosongkannya tiap
                  ketikan membuat panel berkedip dan memaksa pembeli menunggu dari nol berulang
                  kali, padahal hasil lamanya sering sudah memuat yang ia cari. */}
              {showStaleWhileLoading && (
                <p className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin text-brand-primary" />
                  Memperbarui hasil…
                </p>
              )}
            <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
              {displayed.map((address) => (
                <li key={address._id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => handleSelect(address)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition hover:bg-brand-surface"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 flex-none text-brand-primary" />
                    <span>
                      {/* Format: Kelurahan, Kecamatan, Kota, Provinsi */}
                      {toTitleCase(
                        `${address.SUBDISTRICT_NAME}, ${address.DISTRICT_NAME}, ${address.CITY_NAME}, ${address.PROVINCE_NAME}`,
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
