// tests/unit/email-domain.test.ts
// Cek domain email lewat DNS (lib/email-domain.ts). Yang paling mahal kalau salah: MENOLAK pembeli
// asli karena DNS tersendat. Karena itu sebagian besar uji di sini memastikan kondisi ragu-ragu
// berakhir 'unknown' (diloloskan), dan hanya jawaban DNS yang pasti berakhir 'no-mail'.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetEmailDomainCache,
  checkEmailDomain,
  classifyEmailDomain,
  type MxResolver,
} from '@/lib/email-domain'

// Galat DNS tiruan dengan kode seperti yang dilempar node:dns
const dnsError = (code: string) => Object.assign(new Error(code), { code })

function resolver(over: Partial<MxResolver> = {}): MxResolver {
  return {
    resolveMx: vi.fn(async () => [{ exchange: 'mx.contoh.id', priority: 10 }]),
    resolve4: vi.fn(async () => []),
    resolve6: vi.fn(async () => []),
    ...over,
  }
}

beforeEach(() => __resetEmailDomainCache())

describe('classifyEmailDomain', () => {
  it('domain penyedia besar dijawab tanpa DNS', async () => {
    const r = resolver()
    expect(await classifyEmailDomain('gmail.com', r)).toBe('ok')
    expect(r.resolveMx).not.toHaveBeenCalled()
  })

  it('punya MX → ok', async () => {
    expect(await classifyEmailDomain('infarm.co.id', resolver())).toBe('ok')
  })

  it('domain tidak ada (ENOTFOUND) → no-mail', async () => {
    const r = resolver({ resolveMx: vi.fn(async () => Promise.reject(dnsError('ENOTFOUND'))) })
    expect(await classifyEmailDomain('tidakada-xyz.com', r)).toBe('no-mail')
  })

  it('null MX (RFC 7505) → no-mail', async () => {
    const r = resolver({ resolveMx: vi.fn(async () => [{ exchange: '', priority: 0 }]) })
    expect(await classifyEmailDomain('noreply.contoh.id', r)).toBe('no-mail')
  })

  it('tanpa MX tapi punya alamat A → ok (pengiriman jatuh ke A)', async () => {
    const r = resolver({
      resolveMx: vi.fn(async () => Promise.reject(dnsError('ENODATA'))),
      resolve4: vi.fn(async () => ['203.0.113.7']),
    })
    expect(await classifyEmailDomain('kecil.contoh.id', r)).toBe('ok')
  })

  it('tanpa MX dan tanpa A/AAAA → no-mail', async () => {
    const r = resolver({
      resolveMx: vi.fn(async () => Promise.reject(dnsError('ENODATA'))),
      resolve4: vi.fn(async () => Promise.reject(dnsError('ENODATA'))),
      resolve6: vi.fn(async () => Promise.reject(dnsError('ENODATA'))),
    })
    expect(await classifyEmailDomain('parkir.contoh.id', r)).toBe('no-mail')
  })

  it('DNS gagal (SERVFAIL/timeout) → unknown, BUKAN no-mail', async () => {
    for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED']) {
      const r = resolver({ resolveMx: vi.fn(async () => Promise.reject(dnsError(code))) })
      expect(await classifyEmailDomain('apa.saja.id', r)).toBe('unknown')
    }
  })

  it('tanpa MX dan pencarian A/AAAA gagal → unknown', async () => {
    const r = resolver({
      resolveMx: vi.fn(async () => Promise.reject(dnsError('ENODATA'))),
      resolve4: vi.fn(async () => Promise.reject(dnsError('ETIMEOUT'))),
      resolve6: vi.fn(async () => Promise.reject(dnsError('ETIMEOUT'))),
    })
    expect(await classifyEmailDomain('ragu.contoh.id', r)).toBe('unknown')
  })
})

describe('checkEmailDomain', () => {
  it('mengambil domain dari alamat email (huruf besar dinormalkan)', async () => {
    const r = resolver({ resolveMx: vi.fn(async () => Promise.reject(dnsError('ENOTFOUND'))) })
    expect(await checkEmailDomain('Budi@GLAIM-TIDAKADA.COM', { resolver: r })).toBe('no-mail')
    expect(r.resolveMx).toHaveBeenCalledWith('glaim-tidakada.com')
  })

  it('DNS lebih lambat dari batas waktu → unknown (diloloskan)', async () => {
    const r = resolver({ resolveMx: vi.fn(() => new Promise<never>(() => {})) })
    expect(await checkEmailDomain('a@lambat.contoh.id', { resolver: r, timeoutMs: 20 })).toBe('unknown')
  })

  it('jawaban pasti disimpan di cache — DNS tak ditanya dua kali', async () => {
    const r = resolver()
    await checkEmailDomain('a@toko.contoh.id', { resolver: r })
    await checkEmailDomain('b@toko.contoh.id', { resolver: r })
    expect(r.resolveMx).toHaveBeenCalledTimes(1)
  })

  it('unknown TIDAK disimpan — percobaan berikutnya bertanya lagi', async () => {
    const r = resolver({ resolveMx: vi.fn(async () => Promise.reject(dnsError('ESERVFAIL'))) })
    await checkEmailDomain('a@ragu.contoh.id', { resolver: r })
    await checkEmailDomain('a@ragu.contoh.id', { resolver: r })
    expect(r.resolveMx).toHaveBeenCalledTimes(2)
  })

  it('tanpa @ → unknown', async () => {
    expect(await checkEmailDomain('bukan-email', { resolver: resolver() })).toBe('unknown')
  })
})
