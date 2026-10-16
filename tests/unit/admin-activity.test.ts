// tests/unit/admin-activity.test.ts
// Log aktivitas admin (tabel admin_activity_log): isi `details` dan sifat best-effort pencatatannya.
//
// Yang MAHAL kalau salah: password/token ikut tersimpan di log, atau gagal menulis log membuat aksi
// admin (batalkan pesanan, refund) ikut gagal — padahal aksinya sendiri sudah terjadi.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REDACTED, diffFields, sanitizeActivityDetails } from '@/lib/admin-activity-details'

const state = {
  identity: { id: 'admin-1', name: 'Admin Sales', role: 'admin' } as
    | { id: string; name: string; role: 'admin' | 'staff' }
    | null,
  insertError: null as { code?: string; message: string } | null,
  insertThrows: false,
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- parameter dibaca lewat insert.mock.calls
const insert = vi.fn(async (_row: Record<string, unknown>) => {
  if (state.insertThrows) throw new Error('jaringan putus')
  return { error: state.insertError }
})
const from = vi.fn(() => ({ insert }))
const getAdminIdentity = vi.fn(async () => state.identity)

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from }) }))
vi.mock('@/lib/oms-guard', () => ({ getAdminIdentity }))

const { logAdminActivity } = await import('@/lib/admin-activity')

describe('sanitizeActivityDetails', () => {
  it('menyembunyikan field rahasia di level mana pun', () => {
    const out = sanitizeActivityDetails({
      password: 'rahasia',
      nested: { apiKey: 'xnd_live_123', callback_token: 't', ok: 1 },
      list: [{ passwordHash: 'abc' }],
    })
    expect(out).toEqual({
      password: REDACTED,
      nested: { apiKey: REDACTED, callback_token: REDACTED, ok: 1 },
      list: [{ passwordHash: REDACTED }],
    })
  })

  it('membuang undefined, memangkas string panjang dan array besar', () => {
    const out = sanitizeActivityDetails({
      kosong: undefined,
      teks: 'a'.repeat(600),
      ids: Array.from({ length: 60 }, (_, i) => i),
    })
    expect('kosong' in out).toBe(false)
    expect((out.teks as string).length).toBe(501)
    expect((out.ids as unknown[]).length).toBe(51)
    expect((out.ids as unknown[])[50]).toBe('… +10 lainnya')
  })

  it('details kosong menjadi objek kosong (kolom NOT NULL)', () => {
    expect(sanitizeActivityDetails(undefined)).toEqual({})
  })
})

describe('diffFields', () => {
  it('hanya field yang berubah', () => {
    expect(diffFields({ name: 'A', price: 1000, stock: 5 }, { name: 'A', price: 1200 })).toEqual({
      price: { before: 1000, after: 1200 },
    })
  })

  it('null dan undefined dianggap sama; objek dibandingkan isinya', () => {
    expect(diffFields({ alamat: null, items: [1, 2] }, { alamat: undefined, items: [1, 2] })).toEqual({})
  })

  it('field dari data baru yang tak ada sebelumnya tercatat dengan before null', () => {
    expect(diffFields(null, { berat: 480 })).toEqual({ berat: { before: null, after: 480 } })
  })
})

describe('logAdminActivity', () => {
  beforeEach(() => {
    state.identity = { id: 'admin-1', name: 'Admin Sales', role: 'admin' }
    state.insertError = null
    state.insertThrows = false
    insert.mockClear()
    getAdminIdentity.mockClear()
  })

  it('menulis pelaku dari sesi dan details yang sudah dibersihkan', async () => {
    await logAdminActivity({
      action: 'order.status_update',
      entityType: 'order',
      entityId: 'INV-1',
      entityLabel: 'INV-1',
      details: { status: { before: 'Diproses', after: 'Dibatalkan' }, token: 'x' },
    })
    expect(from).toHaveBeenCalledWith('admin_activity_log')
    expect(insert.mock.calls[0][0]).toEqual({
      admin_id: 'admin-1',
      admin_name: 'Admin Sales',
      admin_role: 'admin',
      action: 'order.status_update',
      entity_type: 'order',
      entity_id: 'INV-1',
      entity_label: 'INV-1',
      details: { status: { before: 'Diproses', after: 'Dibatalkan' }, token: REDACTED },
    })
  })

  it('actor null (login gagal) → tanpa pelaku dan tanpa membaca sesi', async () => {
    await logAdminActivity({ action: 'auth.login_failed', entityType: 'auth', entityLabel: 'x@infarm.id', actor: null })
    expect(getAdminIdentity).not.toHaveBeenCalled()
    expect(insert.mock.calls[0][0]).toMatchObject({ admin_id: null, admin_name: null, details: {} })
  })

  it('tak pernah melempar galat: insert error maupun exception', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.insertError = { code: '23514', message: 'check violation' }
    await expect(logAdminActivity({ action: 'product.delete', entityType: 'product' })).resolves.toBeUndefined()
    state.insertError = null
    state.insertThrows = true
    await expect(logAdminActivity({ action: 'product.delete', entityType: 'product' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('tabel belum di-migrate → diam, tanpa console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.insertError = { code: 'PGRST205', message: 'relation not found' }
    await logAdminActivity({ action: 'setting.update', entityType: 'setting' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
