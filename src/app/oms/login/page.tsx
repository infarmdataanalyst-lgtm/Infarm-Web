'use client'

// src/app/oms/login/page.tsx
// Halaman Login OMS (Order Management System) — area internal Infarm, bukan untuk pembeli umum.
// Layout split-screen di desktop (panel visual + form), terpusat penuh di mobile.
// Catatan: autentikasi nyata via Supabase Auth menyusul (lihat checklist OMS di CLAUDE.md).
// Sementara memakai satu akun dummy hardcode untuk validasi login.

import { useState, type FormEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// === Akun dummy sementara ===
// Satu kredensial staf internal yang dikunci di kode sampai Supabase Auth siap.
// TODO: hapus & ganti dengan signInWithPassword Supabase setelah OMS dibangun.
const DUMMY_CREDENTIALS = {
  email: 'admin@infarm.id',
  password: 'admin',
} as const

export default function OmsLoginPage() {
  const router = useRouter()

  // === State formulir ===
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Error per-field agar pesan muncul tepat di bawah input terkait
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  // Error autentikasi umum (kredensial salah) — tampil di atas tombol login
  const [authError, setAuthError] = useState<string | null>(null)

  // === Validasi sederhana sisi frontend ===
  // Mengembalikan map error; kosong berarti valid. Validasi penuh tetap wajib di server.
  function validate(): { email?: string; password?: string } {
    const next: { email?: string; password?: string } = {}
    if (!email.trim()) {
      next.email = 'Email kerja wajib diisi.'
    } else if (!email.includes('@')) {
      next.email = 'Format email tidak valid (harus mengandung "@").'
    }
    if (!password) {
      next.password = 'Kata sandi wajib diisi.'
    }
    return next
  }

  // Submit: validasi field → simulasi tembak server (1 dtk) → cek kredensial dummy.
  // Cocok → redirect dashboard. Salah → tampilkan pesan error & matikan loading.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAuthError(null)

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setIsLoading(true)
    // Jeda buatan agar terasa seperti menembak server asli.
    // TODO: ganti dengan signInWithPassword Supabase Auth setelah OMS dibangun.
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const isValid =
      email.trim() === DUMMY_CREDENTIALS.email &&
      password === DUMMY_CREDENTIALS.password

    if (isValid) {
      router.push('/oms/dashboard')
      return
    }

    setAuthError(
      'Email kerja atau kata sandi yang Anda masukkan salah. Silakan periksa kembali.',
    )
    setIsLoading(false)
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      {/* ============================================================
          KOLOM KIRI — Sisi visual (hanya desktop)
         ============================================================ */}
      <aside className="relative hidden items-center justify-center overflow-hidden bg-emerald-950 p-12 text-white md:flex">
        {/* Ornamen gradasi lembut agar tidak flat */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-900/40 via-emerald-950 to-emerald-950" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-700/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-emerald-600/10 blur-3xl" />

        {/* Konten tunggal terpusat: logo transparan + judul */}
        <div className="relative z-10 flex flex-col items-center text-center">
          <Image
            src="/images/logo-infarm.png"
            alt="Infarm.id"
            width={160}
            height={160}
            className="h-32 w-32 object-contain"
            priority
          />
          <h1 className="mt-6 text-4xl font-bold leading-tight">Infarm OMS</h1>
        </div>
      </aside>

      {/* ============================================================
          KOLOM KANAN — Formulir login (fokus utama)
         ============================================================ */}
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12 md:bg-white">
        <div className="w-full max-w-sm">
          {/* Logo kecil khusus mobile (panel kiri tersembunyi) */}
          <div className="mb-8 flex justify-center md:hidden">
            <Image
              src="/images/logo-infarm.png"
              alt="Infarm.id"
              width={64}
              height={64}
              className="h-16 w-16 object-contain"
              priority
            />
          </div>

          {/* === Header form === */}
          <div className="text-center md:text-left">
            <h2 className="text-2xl font-bold text-gray-900">
              Selamat Datang Kembali
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Silakan masuk ke akun OMS Infarm Anda
            </p>
          </div>

          {/* === Formulir === */}
          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            {/* --- Email --- */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email Kerja
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <MailIcon />
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@infarm.id"
                  aria-invalid={!!errors.email}
                  className={inputClass(!!errors.email)}
                />
              </div>
              {errors.email && <FieldError>{errors.email}</FieldError>}
            </div>

            {/* --- Password --- */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Kata Sandi
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <LockIcon />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  className={`${inputClass(!!errors.password)} pr-10`}
                />
                {/* Tombol show/hide password */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && <FieldError>{errors.password}</FieldError>}
            </div>

            {/* --- Baris opsi: Ingat Saya + Lupa Kata Sandi --- */}
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
                />
                Ingat Saya
              </label>
              <Link
                href="/oms/forgot-password"
                className="text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
              >
                Lupa Kata Sandi?
              </Link>
            </div>

            {/* --- Pesan error autentikasi (kredensial salah) --- */}
            {authError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
              >
                <AlertIcon />
                <span>{authError}</span>
              </div>
            )}

            {/* --- Tombol aksi utama --- */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-emerald-700 py-3 font-semibold text-white transition-all hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Memproses…
                </span>
              ) : (
                'Masuk ke Dashboard'
              )}
            </button>
          </form>

          {/* Catatan keamanan */}
          <p className="mt-8 text-center text-xs text-gray-400">
            Akses dipantau. Hanya untuk staf Infarm yang berwenang.
          </p>
        </div>
      </main>
    </div>
  )
}

// === Helper kelas input (border merah saat error) ===
function inputClass(hasError: boolean): string {
  const base =
    'block w-full rounded-lg border bg-white py-2.5 pl-10 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2'
  const state = hasError
    ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
    : 'border-gray-300 focus:border-emerald-600 focus:ring-emerald-100'
  return `${base} ${state}`
}

// === Sub-komponen presentasional ===

// Pesan error merah rapi di bawah input
function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-sm text-red-500">{children}</p>
}

// === Ikon inline (stroke = currentColor agar ikut warna teks) ===

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  )
}
