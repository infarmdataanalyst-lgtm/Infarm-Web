// src/hooks/use-debounce.ts
// Custom hook generik untuk menunda (debounce) perubahan sebuah nilai.
// Dipakai pencarian agar filter tidak dijalankan tiap ketukan, melainkan setelah user berhenti mengetik.

'use client'

import { useEffect, useState } from 'react'

// Mengembalikan salinan `value` yang baru ikut berubah setelah `delay` ms tanpa perubahan lagi.
// Setiap perubahan `value` me-reset timer, jadi nilai final hanya menyusul saat input "diam".
export function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    // Bersihkan timer bila value/delay berubah sebelum jeda selesai → mencegah update usang
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
