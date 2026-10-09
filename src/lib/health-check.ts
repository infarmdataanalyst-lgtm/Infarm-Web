// src/lib/health-check.ts
// Inti pemeriksaan kesehatan untuk GET /api/health. Murni terhadap I/O: fungsi ini TIDAK tahu
// Supabase — ia menerima sebuah `probe` (satu query ringan) dan memutuskan `ok` atau `degraded`.
// Dipisah dari route agar bisa diuji di Vitest tanpa jaringan, termasuk jalur timeout.
//
// ── Yang dijaga ──
//   1. Jangan pernah menggantung. Pemantau luar (uptime monitor) menunggu jawaban; bila database
//      tak merespons, kita harus menjawab 503 dalam hitungan detik, bukan menunggu sampai fungsi
//      Vercel dimatikan. Karena itu probe dibatasi `timeoutMs` dan sinyalnya dibatalkan.
//   2. Jangan membocorkan isi dalam. Hasilnya hanya dua kata — `ok` / `degraded` — tanpa pesan
//      error, nama host, versi, atau latensi. Alasan kegagalan hanya ke log server.

export type HealthStatus = 'ok' | 'degraded'

export type HealthResult = {
  status: HealthStatus
  // 200 bila sehat, 503 bila terganggu — kode yang dipahami uptime monitor tanpa membaca body.
  httpStatus: 200 | 503
}

// Batas tunggu probe. Query `select id limit 1` normalnya puluhan milidetik; 3 detik sudah
// berarti database sedang bermasalah, dan masih jauh di bawah batas durasi fungsi.
export const HEALTH_PROBE_TIMEOUT_MS = 3000

// Satu query ringan. Mengembalikan `error` null bila berhasil; `signal` dibatalkan saat timeout.
export type HealthProbe = (signal: AbortSignal) => Promise<{ error: { message: string } | null }>

const LOG = '[health]'

// Menjalankan probe dengan batas waktu dan menerjemahkannya menjadi status kesehatan.
// Error, exception, maupun timeout semuanya → `degraded` (alasannya hanya dicatat ke log server).
export async function runHealthCheck(
  probe: HealthProbe,
  timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<{ error: { message: string } }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ error: { message: `probe melebihi ${timeoutMs} ms` } })
    }, timeoutMs)
  })

  try {
    const { error } = await Promise.race([probe(controller.signal), timeout])
    if (error) {
      console.error(`${LOG} degraded:`, error.message)
      return { status: 'degraded', httpStatus: 503 }
    }
    return { status: 'ok', httpStatus: 200 }
  } catch (err) {
    // createPublicClient() melempar bila env Supabase kosong; probe pun bisa melempar saat
    // koneksi putus. Keduanya sama-sama berarti layanan tak sehat.
    console.error(`${LOG} degraded (exception):`, err instanceof Error ? err.message : String(err))
    return { status: 'degraded', httpStatus: 503 }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
