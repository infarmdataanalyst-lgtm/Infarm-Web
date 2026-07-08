// src/lib/oms-auth.ts
// Sesi admin OMS berbasis token BERTANDA TANGAN (HMAC-SHA256), bukan lagi cookie penanda "1".
// Token = base64url(payload).signature — nilai cookie tak bisa dipalsukan tanpa secret server.
// Dipakai bersama oleh proxy.ts (verifikasi, edge) dan route handler login (buat token, node).
//
// Memakai Web Crypto (globalThis.crypto.subtle) agar jalan di edge (proxy) MAUPUN node (route).
// Verifikasi password (scrypt) ada di modul terpisah server-only: src/lib/oms-admin.ts.

// Nama cookie sesi admin OMS.
export const OMS_SESSION_COOKIE = 'oms_session'

// Tujuan default setelah login bila tak ada ?redirect yang valid.
export const OMS_DEFAULT_REDIRECT = '/oms/dashboard'

// Umur sesi (detik): 30 hari bila "Ingat Saya", selain itu 12 jam.
export const OMS_SESSION_MAX_AGE_REMEMBER = 60 * 60 * 24 * 30
export const OMS_SESSION_MAX_AGE_DEFAULT = 60 * 60 * 12

// Secret penandatangan sesi. Pakai env bila ada; fallback konstanta untuk mode prototipe.
// TODO: WAJIB set OMS_SESSION_SECRET di environment production (jangan pakai fallback).
const SECRET = process.env.OMS_SESSION_SECRET ?? 'infarm-dev-oms-session-secret'

// Pastikan target redirect aman: hanya path internal area dashboard OMS (cegah open redirect
// ke URL absolut / domain luar). Selain itu, kembalikan tujuan default.
export function sanitizeOmsRedirect(target: string | null | undefined): string {
  if (!target) return OMS_DEFAULT_REDIRECT
  if (target.startsWith('/oms/dashboard')) return target
  return OMS_DEFAULT_REDIRECT
}

// === Util base64url (tanpa padding) ===

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stringToBase64Url(str: string): string {
  return bytesToBase64Url(new TextEncoder().encode(str))
}

function base64UrlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// === Tanda tangan HMAC-SHA256 (Web Crypto) ===

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return bytesToBase64Url(new Uint8Array(sig))
}

// Bandingkan dua string secara waktu-konstan (cegah timing attack pada verifikasi tanda tangan).
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type SessionPayload = { sub: string; exp: number }

// Membuat token sesi bertanda tangan untuk seorang admin. maxAgeSec menentukan kedaluwarsa.
export async function createSessionToken(adminId: string, maxAgeSec: number): Promise<string> {
  const payload: SessionPayload = { sub: adminId, exp: Date.now() + maxAgeSec * 1000 }
  const payloadB64 = stringToBase64Url(JSON.stringify(payload))
  const sig = await sign(payloadB64)
  return `${payloadB64}.${sig}`
}

// Memverifikasi token sesi: tanda tangan cocok & belum kedaluwarsa. Mengembalikan adminId atau null.
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)

  const expected = await sign(payloadB64)
  if (!timingSafeEqualStr(sig, expected)) return null

  try {
    const payload = JSON.parse(base64UrlToString(payloadB64)) as SessionPayload
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    return payload.sub
  } catch {
    return null
  }
}
