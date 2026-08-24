// src/lib/mengantar-tracking.ts
// Detail pelacakan paket dari Mengantar (riwayat scan kurir). SERVER ONLY.
//
// ── Kontrak endpoint (dokumentasi resmi app.mengantar.com/docs) ──
//   GET {BASE}/api/public/{API_KEY}/order?tracking_id={NO_RESI}
//
// Riwayat scan ada di `data[0].history`, dan HANYA muncul pada pencarian SATU pesanan
// (`tracking_id` / `order_id`). Respons DAFTAR tak memuatnya — lihat TRACKING_QUERY_PARAM.
//
// SERVER ONLY: URL memuat API key sebagai SEGMEN PATH, jadi memanggilnya dari browser
// membocorkannya utuh. Selain itu hasilnya dipakai stepper yang dirender server, sehingga fetch
// dari klien berarti dua panggilan untuk satu halaman.
//
// ── Bentuk peristiwa (docs → history[]) ──
//   { date: "27-09-2022 08:30",   // DD-MM-YYYY HH:mm, zona Asia/Jakarta
//     desc: "Shipment Picked Up By Courier" }
// Sebagian respons juga menyertakan `timestamp` ISO ber-offset dan `code`; keduanya opsional.
// Urutan dari Mengantar: TERLAMA DULU (lihat EVENTS_ARE_OLDEST_FIRST).
//
// Catatan docs: teks `desc` berasal dari kurir pihak ketiga sehingga kata-katanya berbeda antar
// kurir — itu alasan pemetaan tahap stepper memakai kata kunci, bukan daftar status tertutup.
//
// ── Kenapa pencarian array peristiwa berbasis BENTUK, bukan nama field ──
// Saat parameternya masih salah (`?cnote_no=`), respons yang datang adalah objek PESANAN dengan
// `status: "active"`. Pencarian berbasis nama field mengira itu peristiwa, dan pembeli melihat satu
// baris berbunyi "active" seolah kabar dari kurir. Sejak itu sebuah array baru diterima bila
// elemennya punya field WAKTU dan DESKRIPSI sekaligus, dan bukan objek pesanan.

import { mengantarHost } from '@/lib/mengantar-host'

const LOG = '[mengantar-tracking]'

// ⚠️ JEBAKAN PARAMETER — jangan diubah tanpa membaca ini.
//
// `?tracking_id=` mengembalikan SATU pesanan LENGKAP DENGAN `history`.
// `?cnote_no=`    adalah PENCARIAN DAFTAR — respons daftar SENGAJA tidak memuat `history`.
//
// Keduanya membalas 200 dengan bentuk yang mirip, jadi salah pilih tak terlihat seperti error:
// yang terjadi hanya "riwayat selalu kosong". Ini sudah pernah memakan waktu — sempat disimpulkan
// bahwa Mengantar tak menyediakan riwayat lewat API sama sekali, padahal parameternya saja salah.
// Kutipan dokumentasi (app.mengantar.com/docs):
//   "tracking_id — Tracking number (cnote_no) — returns single order with full history"
//   "This field is not returned in list responses — only when looking up a specific order."
const TRACKING_QUERY_PARAM = 'tracking_id'

// Apakah Mengantar mengirim peristiwa dari yang PALING LAMA lebih dulu.
// ⚠️ ASUMSI — cocokkan dengan respons sungguhan. Bila ternyata sudah terbaru-dulu, ubah ke false.
const EVENTS_ARE_OLDEST_FIRST = true

// Timeout pendek: pemanggilan terjadi saat halaman /track dirender, jadi pembeli menunggu.
// Gagal/timeout TIDAK menggagalkan halaman — bagian pelacakan saja yang menampilkan pesan.
const REQUEST_TIMEOUT_MS = 4_000

// Umur cache. Tujuannya menahan panggilan berulang saat pembeli me-refresh halaman berkali-kali;
// status paket toh tak berubah tiap detik.
const CACHE_TTL_MS = 10 * 60 * 1000

// === Bentuk hasil ===

// Satu peristiwa perjalanan paket.
export type TrackingEvent = {
  // Waktu apa adanya dari Mengantar (mis. "25 Jun 2026 08:32pm"). TIDAK diparse ulang: format
  // kurir bisa berubah, dan menampilkan teks aslinya lebih jujur daripada menebak zona waktu lalu
  // salah menggeser jamnya.
  timestamp: string
  // Deskripsi peristiwa (mis. "Arrived At Destination Hub (Kuningan)")
  label: string
}

export type TrackingResult =
  | { ok: true; events: TrackingEvent[] } // events kosong = resi belum aktif di sistem kurir
  | { ok: false; reason: TrackingFailureReason; detail: string }

export type TrackingFailureReason =
  | 'not-configured' // MENGANTAR_API_KEY belum di-set
  | 'no-awb' // pesanan belum punya nomor resi
  | 'unauthorized' // 401/403 — endpoint butuh sesi login dashboard, API key tak berlaku
  | 'http-error' // Mengantar menolak (termasuk 404 = path salah / resi tak dikenal)
  | 'bad-shape' // respons terbaca tapi tak ada array peristiwa yang dikenali
  | 'network' // timeout / jaringan

// === Cache (in-memory, per instance) ===
//
// Pola sama dengan `optionsCache` di warehouse-shipping.ts: best-effort, hilang saat instance
// mati. Aman karena kehilangannya hanya berarti satu panggilan tambahan ke Mengantar.
type CacheEntry = { at: number; result: TrackingResult }
const cache = new Map<string, CacheEntry>()

function readCache(awb: string): TrackingResult | null {
  const entry = cache.get(awb)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(awb)
    return null
  }
  return entry.result
}

function writeCache(awb: string, result: TrackingResult): void {
  // Sapu entri kedaluwarsa berkala agar Map tak tumbuh tanpa batas
  if (cache.size > 200) {
    const now = Date.now()
    for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k)
  }
  cache.set(awb, { at: Date.now(), result })
}

// === Pemetaan respons (SENGAJA toleran) ===

// Kandidat nama field untuk waktu & deskripsi satu peristiwa.
const TIME_KEYS = ['date_time', 'datetime', 'date', 'time', 'timestamp', 'eventDate', 'created_at', 'createdAt', 'scan_date']
const LABEL_KEYS = ['status', 'description', 'desc', 'event', 'note', 'remark', 'message', 'position', 'scan_status', 'title']

// Kedalaman maksimal penelusuran. Respons pesanan Mengantar bersarang beberapa tingkat; batas ini
// mencegah penelusuran tak berujung pada struktur yang saling menunjuk.
const MAX_SEARCH_DEPTH = 5

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

// Waktu peristiwa untuk ditampilkan: "25 Jun 2026, 20.25".
//
// `timestamp` Mengantar berformat ISO ber-offset ("2026-06-25T20:25:17+0700"), jadi zonanya
// EKSPLISIT dan aman diparse. Tetap dirender di zona Asia/Jakarta supaya jamnya sama dengan yang
// dilihat pembeli di Indonesia, bukan mengikuti zona server (Vercel = UTC).
//
// Gagal parse → pakai `date` mentah dari Mengantar apa adanya. Menampilkan teks aslinya lebih jujur
// daripada menebak format lain lalu menggeser jam secara meyakinkan tapi salah.
// "27-09-2022 08:30" (DD-MM-YYYY HH:mm, zona Asia/Jakarta) → Date, atau null bila tak cocok.
//
// Format ini TERDOKUMENTASI (app.mengantar.com/docs → history[].date), termasuk zonanya — jadi
// aman diparse. Offset +07:00 ditulis eksplisit; tanpa itu, Date memakai zona server (Vercel = UTC)
// dan seluruh jam bergeser 7 jam.
const MENGANTAR_DATE_RE = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})/
function parseMengantarDate(value: string): Date | null {
  const m = MENGANTAR_DATE_RE.exec(value.trim())
  if (!m) return null
  const [, dd, mm, yyyy, hh, min] = m
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+07:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatEventTime(isoTimestamp: string, fallback: string): string {
  // `timestamp` ISO didahulukan bila ada (dikirim sebagian respons), lalu `date` berformat
  // Mengantar. Keduanya gagal → tampilkan teks aslinya apa adanya.
  const d = (isoTimestamp ? new Date(isoTimestamp) : null) ?? parseMengantarDate(fallback)
  if (!d || Number.isNaN(d.getTime())) return fallback
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(d)
  const jam = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(d)
  return `${tanggal}, ${jam}`
}

// Field yang menandai sebuah objek adalah PESANAN, bukan peristiwa perjalanan.
//
// Wajib ada. Uji "punya waktu DAN deskripsi" saja TIDAK cukup: objek pesanan Mengantar punya
// `createdAt` (waktu) dan `status: "active"` (deskripsi), jadi ia lolos — dan pembeli melihat satu
// baris berbunyi "active" seolah itu kabar dari kurir. Terbukti terjadi saat pengujian pertama.
const ORDER_MARKER_KEYS = [
  'cnote_no',
  'COD_AMOUNT',
  'receiverScore',
  'assignee',
  'isPaid',
  'isArchived',
  'ticketStatus',
  'printedDates',
]

// Apakah objek ini objek PESANAN (bukan peristiwa)?
function looksLikeOrder(row: Record<string, unknown>): boolean {
  return ORDER_MARKER_KEYS.some((k) => k in row)
}

// Apakah sebuah objek BERBENTUK peristiwa perjalanan: punya waktu DAN deskripsi, DAN bukan objek
// pesanan.
function looksLikeEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (looksLikeOrder(row)) return false
  const hasTime = TIME_KEYS.some((k) => asString(row[k]) !== '')
  const hasLabel = LABEL_KEYS.some((k) => asString(row[k]) !== '')
  return hasTime && hasLabel
}

// Mencari array peristiwa di mana pun ia bersarang, berdasar BENTUK elemennya — bukan namanya.
//
// Pendekatan berbasis bentuk dipilih karena nama fieldnya belum dipastikan, sementara "array yang
// isinya objek berwaktu-dan-berdeskripsi" adalah ciri yang jauh lebih stabil daripada tebakan
// nama. Array pertama yang lolos itulah yang dipakai.
function findEventArray(body: unknown, depth = 0): unknown[] | null {
  if (depth > MAX_SEARCH_DEPTH) return null

  if (Array.isArray(body)) {
    // Array peristiwa: minimal satu elemennya berbentuk peristiwa.
    if (body.some(looksLikeEvent)) return body
    // Bukan — mungkin array pembungkus (mis. `data: [ {pesanan} ]`); telusuri isinya.
    for (const item of body) {
      const nested = findEventArray(item, depth + 1)
      if (nested) return nested
    }
    return null
  }

  if (typeof body !== 'object' || body === null) return null
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const nested = findEventArray(value, depth + 1)
    if (nested) return nested
  }
  return null
}

// Mengubah satu entri mentah menjadi TrackingEvent. null bila tak ada teks yang bisa ditampilkan —
// baris tanpa deskripsi tak ada gunanya bagi pembeli.
function normalizeEvent(raw: unknown): TrackingEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    // Sebagian API mengirim array string biasa
    const text = asString(raw)
    return text ? { timestamp: '', label: text } : null
  }
  const row = raw as Record<string, unknown>

  // `timestamp` (ISO ber-offset) DIDAHULUKAN karena zonanya eksplisit; sisanya cadangan.
  let rawTime = ''
  for (const k of TIME_KEYS) {
    const v = asString(row[k])
    if (v) {
      rawTime = v
      break
    }
  }
  // `date` Mengantar ("25-06-2026 20:25") dipakai apa adanya bila timestamp tak bisa diparse.
  const timestamp = formatEventTime(asString(row.timestamp), rawTime)

  let label = ''
  for (const k of LABEL_KEYS) {
    const v = asString(row[k])
    if (v) {
      label = v
      break
    }
  }

  // Lokasi/hub sering terpisah dari deskripsinya → gabungkan bila belum termuat di label
  const place = asString(row.city) || asString(row.hub) || asString(row.location)
  if (place && label && !label.toLowerCase().includes(place.toLowerCase())) {
    label = `${label} (${place})`
  }

  return label ? { timestamp, label } : null
}

// === Pemanggilan ===

// Mengambil detail pelacakan sebuah nomor resi.
//
// TIDAK menyentuh DB — pemanggil yang menyediakan `awb` dari `orders.no_tracking`, supaya modul ini
// tetap bisa diuji tanpa Supabase.
export async function fetchTrackingDetail(awb: string): Promise<TrackingResult> {
  const trimmed = awb.trim()
  if (!trimmed) return { ok: false, reason: 'no-awb', detail: 'nomor resi kosong' }

  const cached = readCache(trimmed)
  if (cached) return cached

  const key = process.env.MENGANTAR_API_KEY
  if (!key) {
    // TIDAK di-cache: begitu env-nya diisi, panggilan berikutnya harus langsung mencoba lagi.
    return { ok: false, reason: 'not-configured', detail: 'MENGANTAR_API_KEY belum di-set' }
  }

  const result = await requestTracking(trimmed, key)
  writeCache(trimmed, result)
  return result
}

async function requestTracking(awb: string, key: string): Promise<TrackingResult> {
  // TIDAK melewati mengantarWriteHost(): ini GET, operasi BACA — tak memotong saldo dan tak
  // menerbitkan apa pun. Penjaga panggilan-tulis hanya untuk POST /order & POST /time.
  const url = `${mengantarHost()}/api/public/${encodeURIComponent(key)}/order?${TRACKING_QUERY_PARAM}=${encodeURIComponent(awb)}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const text = await res.text()

    if (!res.ok) {
      console.warn(`${LOG} resi=${awb} HTTP ${res.status}: ${text.slice(0, 200)}`)
      // 401/403 dibedakan: itu BUKAN gangguan sementara, melainkan endpoint yang memang butuh
      // sesi login dashboard Mengantar (terverifikasi: 401 {"c":"user data not found 1"}).
      // Mengulang tak akan pernah menolong, jadi pembeli tak perlu disuruh mencoba lagi.
      const reason = res.status === 401 || res.status === 403 ? 'unauthorized' : 'http-error'
      return { ok: false, reason, detail: `${res.status} ${text.slice(0, 200)}` }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'bad-shape', detail: `respons bukan JSON: ${text.slice(0, 150)}` }
    }

    const rawEvents = findEventArray(parsed)
    if (!rawEvents) {
      // Respons sah tapi bentuknya belum kita kenali → catat contohnya supaya pemetaannya bisa
      // diperbaiki tanpa perlu memanggil ulang.
      console.warn(`${LOG} resi=${awb} bentuk respons tak dikenali: ${text.slice(0, 400)}`)
      return { ok: false, reason: 'bad-shape', detail: text.slice(0, 300) }
    }

    const events = rawEvents
      .map(normalizeEvent)
      .filter((e): e is TrackingEvent => e !== null)

    // Urutan ditentukan di sini, sekali, supaya UI tak perlu tahu apa pun soal urutan API.
    // Pembeli membaca yang TERBARU di atas (sama seperti dashboard Mengantar).
    // ⚠️ EVENTS_ARE_OLDEST_FIRST adalah asumsi yang WAJIB dicocokkan dengan respons sungguhan:
    // JANGAN mengurutkan dengan mem-parse `timestamp`, karena format waktunya belum dipastikan dan
    // salah parse menghasilkan urutan yang justru terlihat meyakinkan tapi salah.
    if (EVENTS_ARE_OLDEST_FIRST) events.reverse()

    console.log(`${LOG} resi=${awb} ${events.length} peristiwa`)
    return { ok: true, events }
  } catch (e) {
    // Hanya `name`: pesan error fetch di sebagian runtime memuat URL — yang di sini berisi API key.
    return { ok: false, reason: 'network', detail: e instanceof Error ? e.name : 'unknown' }
  }
}
