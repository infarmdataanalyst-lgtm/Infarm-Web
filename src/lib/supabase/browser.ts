// src/lib/supabase/browser.ts
// Supabase client untuk dipakai di komponen browser ('use client').
// Memakai anon key (publik) — akses tetap dibatasi oleh Row Level Security (RLS).

import { createBrowserClient } from '@supabase/ssr'

// Membuat Supabase client sisi-browser (anon key).
// Panggil di dalam komponen 'use client' saat butuh query/realtime dari browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
