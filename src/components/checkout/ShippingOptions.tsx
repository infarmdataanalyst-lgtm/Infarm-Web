'use client'

// src/components/checkout/ShippingOptions.tsx
// Pemilihan kurir & ongkir (Mengantar) lewat pola bottom sheet (seperti PaymentModal):
// tombol trigger menampilkan logo + kurir terpilih → klik membuka bottom sheet berisi daftar kurir
// (kartu berlogo, termurah→termahal) → "Konfirmasi" menyimpan pilihan.
//
// Tiap baris: [logo kurir] [nama + estimasi tiba] … [harga] [centang bila terpilih].
// Logo dari CourierLogo (peta kurir→file di lib/courier-logo.ts).
//
// Daftar kurir = GABUNGAN hasil perbandingan ongkir dari SEMUA gudang yang stoknya cukup
// (/api/mengantar/shipping/options). Buyer tidak perlu tahu tarif itu dari gudang mana — ia hanya
// memilih kurir & harga. Gudang asal ikut tersimpan di pilihan (`warehouseId`) dan dikirim saat
// membuat order, lalu diverifikasi ulang di server.

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, AlertTriangle, Check, X } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import BottomSheet from '@/components/checkout/BottomSheet'
import CourierLogo from '@/components/checkout/CourierLogo'
import { fetchShippingOptions, type WarehouseShippingOption } from '@/lib/mengantar'

// Identitas satu baris pilihan: gudang + kode kurir.
//
// WAJIB gabungan, bukan `courier.id` saja. Daftar ini adalah GABUNGAN hasil beberapa gudang, jadi
// kurir yang sama muncul sekali per gudang dengan tarif berbeda — dan sejak kurir dibatasi J&T
// saja, SEMUA baris ber-id 'JT'. Memakai id saja berakibat dua hal: React memperingatkan
// duplicate key, dan `find(c => c.id === draftId)` mengembalikan baris PERTAMA yang cocok —
// buyer bisa melihat tarif gudang A tapi ordernya diarahkan ke gudang B.
function optionKey(option: WarehouseShippingOption): string {
  return `${option.warehouseId}::${option.id}`
}

// Menampilkan tombol trigger + bottom sheet pemilihan kurir.
// onSelect dipanggil saat buyer menekan "Konfirmasi" (bukan saat sekadar memilih card).
export default function ShippingOptions({
  destinationId,
  weight,
  items,
  selected,
  onSelect,
}: {
  destinationId: string
  weight: number
  // Isi keranjang — dipakai server untuk menilai gudang mana yang stoknya cukup sebelum
  // membandingkan ongkir. Tanpa ini perbandingan bisa menawarkan gudang yang barangnya tak ada.
  items: { productId: string; quantity: number; variantId?: string }[]
  selected: WarehouseShippingOption | null
  onSelect: (courier: WarehouseShippingOption | null) => void
}) {
  const [couriers, setCouriers] = useState<WarehouseShippingOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Alasan daftar kosong. Dipisah dari `error` karena maknanya beda bagi buyer: `error` layak
  // dicoba ulang, `emptyReason` tidak — alamatnya yang tak terlayani.
  const [emptyReason, setEmptyReason] = useState('')
  const [retry, setRetry] = useState(0)

  const [open, setOpen] = useState(false)
  const [draftId, setDraftId] = useState('') // pilihan sementara di dalam sheet (belum dikonfirmasi)

  // Ringkas isi keranjang jadi string stabil supaya efek di bawah tidak berjalan ulang tiap render
  // hanya karena array-nya objek baru (referensi berubah, isinya sama).
  const itemsKey = useMemo(
    () =>
      items
        .map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`)
        .sort()
        .join(','),
    [items],
  )

  // === Fetch ongkir otomatis saat alamat tujuan / berat / isi keranjang berubah (atau "Coba lagi") ===
  useEffect(() => {
    if (!destinationId) return
    const ctrl = new AbortController()
    // items dibangun ulang dari itemsKey agar efek ini tidak bergantung pada referensi array
    const parsedItems = itemsKey
      ? itemsKey.split(',').map((entry) => {
          const [productId, variantId, quantity] = entry.split(':')
          return variantId
            ? { productId, variantId, quantity: Number(quantity) }
            : { productId, quantity: Number(quantity) }
        })
      : []

    // === Batas waktu sisi KLIEN ===
    //
    // Server sudah membatasi panggilannya sendiri ke Mengantar (ESTIMATE_TIMEOUT_MS 4,5 dtk per
    // origin di warehouse-shipping.ts), tapi TARIKAN INI — browser ke proxy kita — tak punya batas
    // apa pun. Akibatnya, apa pun yang membuat proxy menggantung (instance serverless tersendat,
    // jaringan pembeli mati separuh, Mengantar hidup-tapi-diam) meninggalkan pembeli menatap
    // kerangka "Menghitung ongkos kirim…" SELAMANYA: tak ada pesan, tak ada tombol coba lagi, dan
    // tombol bayar tetap terkunci. Terbukti lewat uji kondisi tepi yang menahan proxy 60 detik.
    //
    // 10 detik = jauh di atas jalur normal (server memanggil seluruh gudang PARALEL, masing-masing
    // maksimal 4,5 detik, ditambah beberapa query Supabase) tapi masih di dalam rentang kesabaran
    // manusia. Lebih panjang dari ini hanya memperlama penantian tanpa menaikkan peluang berhasil:
    // kalau 10 detik belum menjawab, tarikan itu memang sudah tersesat.
    const BATAS_KLIEN_MS = 10_000
    let kehabisanWaktu = false
    const timer = setTimeout(() => {
      kehabisanWaktu = true
      ctrl.abort()
    }, BATAS_KLIEN_MS)

    async function load() {
      setLoading(true)
      setError('')
      setEmptyReason('')
      try {
        const { options, reason } = await fetchShippingOptions(
          destinationId,
          weight,
          parsedItems,
          ctrl.signal,
        )
        if (ctrl.signal.aborted) return
        setCouriers(options)
        if (options.length === 0) {
          if (reason === 'ESTIMATE_UNAVAILABLE') {
            // Semua gudang gagal/timeout → layak dicoba ulang, bukan alamatnya yang salah
            setError('Gagal memuat ongkos kirim, silakan coba lagi')
          } else {
            // J&T tak melayani rute ini. Sebut kurirnya dengan jelas — "belum ada kurir tersedia"
            // membuat buyer menyangka seluruh alamatnya bermasalah dan mencoba ulang tanpa guna.
            setEmptyReason(
              'Maaf, J&T tidak melayani pengiriman ke alamat ini saat ini. Coba gunakan alamat lain.',
            )
          }
        }
      } catch (err) {
        // `kehabisanWaktu` diperiksa LEBIH DULU daripada `aborted`.
        //
        // Kedua keadaan sama-sama membuat signal ter-abort, tapi maknanya berlawanan: abort dari
        // cleanup berarti komponennya sudah tak peduli lagi (alamat berganti / unmount), sedangkan
        // abort dari batas waktu berarti pembeli MASIH MENUNGGU dan berhak diberi tahu. Memeriksa
        // `aborted` saja menelan keduanya dan mengembalikan kerangka tak berujung.
        if (kehabisanWaktu) {
          setError('Gagal memuat ongkos kirim, silakan coba lagi')
          setCouriers([])
        } else if (!ctrl.signal.aborted) {
          // Pesan dari server dipakai bila ada (mis. 429 "terlalu banyak percobaan")
          setError(err instanceof Error ? err.message : 'Gagal memuat ongkos kirim, silakan coba lagi')
          setCouriers([])
        }
      } finally {
        clearTimeout(timer)
        // Idem: pada kehabisan waktu, `loading` WAJIB dimatikan walau signal ter-abort — kalau
        // tidak, pesan galat sudah ada tapi tertutup kerangka yang tak pernah berhenti berdenyut.
        if (kehabisanWaktu || !ctrl.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [destinationId, weight, itemsKey, retry])

  // Server sudah memfilter kurir (daftar putih J&T + yang benar-benar melayani) dan mengurutkan
  // termurah; pengurutan diulang di sini sebagai jaring pengaman bila bentuk respons berubah.
  const supported = useMemo(() => [...couriers].sort((a, b) => a.price - b.price), [couriers])

  // Auto-pilih opsi termurah saat baru dimuat dan buyer belum memilih apa pun.
  //
  // Sejak kurir dibatasi J&T saja, tinggal satu nama kurir — memaksa buyer membuka sheet lalu
  // menekan "Konfirmasi" hanya untuk satu-satunya pilihan adalah langkah kosong yang menahan tombol
  // "Bayar Sekarang". Ongkirnya tetap terlihat di baris trigger, dan sheet tetap bisa dibuka: bila
  // ada beberapa gudang, J&T muncul beberapa kali dengan tarif berbeda dan buyer masih boleh
  // memilih yang lain.
  //
  // Hanya berjalan saat `selected` masih null → tidak pernah menimpa pilihan buyer, dan tidak
  // menahannya kalau ia sengaja memilih opsi yang lebih mahal.
  useEffect(() => {
    if (supported.length === 0) return

    // Belum memilih apa pun → ambil yang termurah.
    if (!selected) {
      onSelect(supported[0])
      return
    }

    // Sudah ada pilihan, TAPI ia tak ada di daftar tarif yang baru.
    //
    // Terjadi saat pilihan dipulihkan dari draf localStorage (refresh halaman): kurir & harganya
    // berasal dari kutipan lama, sementara daftar ini baru saja ditarik untuk tujuan, berat, dan
    // isi keranjang yang berlaku SEKARANG. Membiarkannya berarti pembeli melihat tarif basi, dan
    // `POST /api/orders/create` menolaknya dengan 409 SHIPPING_MISMATCH tepat saat ia menekan
    // bayar — kegagalan di titik paling mahal.
    //
    // Dicocokkan lewat optionKey (gudang + kurir + harga), jadi perubahan harga sekalipun
    // terhitung "tak ada lagi" dan memicu penggantian.
    const masihAda = supported.some((c) => optionKey(c) === optionKey(selected))
    if (!masihAda) onSelect(supported[0])

    // onSelect sengaja tak masuk dependency: identitasnya bisa berubah tiap render induk
    // (fungsi inline), yang akan membuat efek ini berjalan berulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, selected])

  const disabled = !destinationId
  const draftValid = supported.some((c) => optionKey(c) === draftId)

  // Buka sheet dengan pilihan awal = kurir yang sudah dikonfirmasi (bila ada)
  function openSheet() {
    setDraftId(selected ? optionKey(selected) : '')
    setOpen(true)
  }

  // Simpan pilihan & tutup sheet
  function handleConfirm() {
    const courier = supported.find((c) => optionKey(c) === draftId)
    if (courier) onSelect(courier)
    setOpen(false)
  }

  const triggerValue = selected
    ? `${selected.name} — ${formatRupiah(selected.price)} (${selected.estimatedDate})`
    : 'Pilih Kurir Pengiriman'

  return (
    <>
      {/* === Tombol trigger (pola seperti OptionRow) === */}
      <button
        type="button"
        onClick={openSheet}
        disabled={disabled}
        title={disabled ? 'Pilih alamat pengiriman terlebih dahulu' : undefined}
        className="flex w-full items-center gap-3 bg-white px-4 py-4 text-left transition active:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Logo kurir terpilih; belum memilih → CourierLogo jatuh ke ikon truk generik.
            Buyer jadi mengenali kurirnya tanpa perlu membuka sheet. */}
        <CourierLogo courier={selected?.id} label={selected?.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500">Metode Pengiriman</p>
          <p className={`truncate text-sm font-semibold ${selected ? 'text-zinc-800' : 'text-zinc-400'}`}>
            {triggerValue}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
      </button>

      {/* === Bottom sheet pilihan kurir === */}
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        {/* Header: judul + tombol silang */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="text-base font-bold text-zinc-800">Pilih Kurir Pengiriman</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Tutup" className="p-1 active:scale-95">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body scrollable: skeleton / error / empty / daftar kurir */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <SkeletonList />
          ) : error ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-start gap-2 text-orange-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                <p className="text-sm">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="mt-3 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:brightness-90"
              >
                Coba Lagi
              </button>
            </div>
          ) : supported.length === 0 ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-start gap-2 text-orange-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                <p className="text-sm leading-relaxed">
                  {emptyReason || "Belum ada kurir tersedia ke alamat tujuan."}
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2" role="radiogroup" aria-label="Pilihan kurir">
              {supported.map((courier) => {
                const key = optionKey(courier)
                const active = key === draftId
                return (
                  <li key={key}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDraftId(key)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-brand-primary bg-brand-surface ring-1 ring-brand-primary'
                          : 'border-zinc-200 bg-white hover:border-brand-light'
                      }`}
                    >
                      {/* Logo kurir menggantikan bulatan radio yang dulu di sini: ia lebih cepat
                          dikenali daripada nama yang harus dibaca, dan penanda "terpilih" sudah
                          dibawa oleh border+ring hijau kartu ini. */}
                      <CourierLogo courier={courier.id} label={courier.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-800">{courier.name}</p>
                        <p className="text-xs text-zinc-500">Estimasi tiba: {courier.estimatedDate}</p>
                      </div>
                      <p className="flex-none text-sm font-bold text-brand-primary">
                        {formatRupiah(courier.price)}
                      </p>
                      {/* Centang penanda pilihan, dipindah ke ujung kanan. Ruangnya DISEDIAKAN
                          walau tak aktif (bukan render kondisional) supaya harga tidak bergeser
                          saat buyer berpindah pilihan. */}
                      <span
                        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                          active ? 'bg-brand-primary text-white' : 'bg-transparent'
                        }`}
                        aria-hidden
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer: tombol Konfirmasi (nonaktif bila belum ada pilihan valid) */}
        <div className="shrink-0 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!draftValid}
            className="w-full rounded-xl bg-brand-primary py-3 text-base font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Konfirmasi
          </button>
        </div>
      </BottomSheet>
    </>
  )
}

// Skeleton 3 kartu saat ongkir sedang dimuat
function SkeletonList() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
        Menghitung ongkos kirim…
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
          {/* Ukurannya mengikuti kotak logo (44px) agar tinggi baris tak melompat saat data tiba */}
          <div className="h-11 w-11 flex-none animate-pulse rounded-lg bg-zinc-100" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-24 animate-pulse rounded bg-zinc-100" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-zinc-100" />
          </div>
          <div className="h-4 w-16 flex-none animate-pulse rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  )
}
