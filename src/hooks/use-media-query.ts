'use client'

// src/hooks/use-media-query.ts
// Membaca status media query secara reaktif tanpa setState di dalam useEffect
// (dilarang lint `react-hooks/set-state-in-effect`). Snapshot server selalu `false`
// sehingga render server = varian layar kecil, lalu klien menyesuaikan setelah hidrasi.

import { useCallback, useSyncExternalStore } from 'react'

// Mengembalikan true bila media query cocok. Contoh: useMediaQuery('(min-width: 640px)')
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
