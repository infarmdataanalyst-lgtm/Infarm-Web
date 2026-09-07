// src/lib/supabase/server.ts
// Supabase client untuk sisi-server (Server Component, Route Handler, Server Action).
// Server-only: memakai cookies() dari next/headers, jangan diimpor dari komponen 'use client'.

import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Membuat Supabase client sisi-server dengan anon key.
// Akses tetap dibatasi RLS, dan session user disinkronkan lewat cookie.
// async karena cookies() di Next.js 16 bersifat asynchronous.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // setAll bisa dipanggil dari Server Component yang tidak boleh menulis cookie.
          // Dibungkus try/catch agar tidak error; penulisan cookie ditangani di Route Handler / Server Action.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // diabaikan dengan sengaja — lihat komentar di atas
          }
        },
      },
    },
  )
}

// Membuat Supabase client anon TANPA cookie — untuk baca data yang memang publik.
//
// ── Kenapa terpisah dari createClient() di atas ──
// createClient() memanggil cookies() untuk menyinkronkan sesi Supabase Auth. Dua alasan itu tak
// cocok di sini:
//   1. Storefront memakai guest checkout — tak ada sesi Supabase Auth untuk disinkronkan.
//   2. Baca publik dibungkus unstable_cache (lihat mock-db/cached-reads.ts), dan Next.js MELARANG
//      API dinamis seperti cookies() di dalamnya. Memakai createClient() di sana akan melempar
//      saat runtime, bukan saat build.
//
// Bedanya dengan createAdminClient(): client ini TUNDUK pada RLS. Itulah gunanya — jalur baca
// publik jadi punya lapisan pertahanan kedua di database, sehingga satu bug filter di kode aplikasi
// tak langsung membocorkan baris yang sengaja disembunyikan (SEC-031, SEC-032).
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}

// Membuat Supabase client dengan service_role key (MENEMBUS RLS).
// HANYA untuk operasi server tepercaya (mis. webhook, update stok, proses order).
// Jangan pernah dipakai di komponen klien atau di-expose ke browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}
