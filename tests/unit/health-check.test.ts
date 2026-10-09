// tests/unit/health-check.test.ts
// Inti GET /api/health. Yang mahal kalau salah: endpoint menggantung saat database mati (pemantau
// tak pernah dapat jawaban), atau melaporkan `ok` padahal query gagal.

import { describe, expect, it, vi } from 'vitest'
import { HEALTH_PROBE_TIMEOUT_MS, runHealthCheck } from '@/lib/health-check'

// Redam log error agar keluaran test tetap bersih; isinya tidak diuji.
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('runHealthCheck', () => {
  it('probe tanpa error → ok 200', async () => {
    const hasil = await runHealthCheck(async () => ({ error: null }))
    expect(hasil).toEqual({ status: 'ok', httpStatus: 200 })
  })

  it('probe mengembalikan error → degraded 503', async () => {
    const hasil = await runHealthCheck(async () => ({ error: { message: 'connection refused' } }))
    expect(hasil).toEqual({ status: 'degraded', httpStatus: 503 })
  })

  it('probe melempar exception (mis. env Supabase kosong) → degraded 503', async () => {
    const hasil = await runHealthCheck(async () => {
      throw new Error('supabaseUrl is required.')
    })
    expect(hasil).toEqual({ status: 'degraded', httpStatus: 503 })
  })

  it('probe menggantung → degraded 503 setelah timeout, dan sinyalnya dibatalkan', async () => {
    let sinyal: AbortSignal | undefined
    const menggantung = (signal: AbortSignal) =>
      new Promise<{ error: null }>(() => {
        sinyal = signal
      })

    const mulai = Date.now()
    const hasil = await runHealthCheck(menggantung, 30)

    expect(hasil).toEqual({ status: 'degraded', httpStatus: 503 })
    expect(Date.now() - mulai).toBeLessThan(HEALTH_PROBE_TIMEOUT_MS)
    expect(sinyal?.aborted).toBe(true)
  })

  it('probe yang cepat tidak menunggu timeout', async () => {
    const mulai = Date.now()
    await runHealthCheck(async () => ({ error: null }), 5000)
    expect(Date.now() - mulai).toBeLessThan(1000)
  })
})
