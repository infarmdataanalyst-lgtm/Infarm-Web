'use client'

// src/hooks/use-sticky-bar-height.ts
// Mendaftarkan tinggi sebuah bilah aksi bawah (sticky/fixed) ke CSS variable global
// `--sticky-bar-h` di elemen <html>, supaya elemen mengambang bisa menaikkan posisinya dan tidak
// tertimpa/menimpa bilah tersebut.
//
// CATATAN 2026-09-18: pemakai satu-satunya, tombol WhatsApp mengambang, sudah dipindah ke footer,
// jadi untuk sementara variable ini ditulis tanpa ada yang membacanya. Sengaja dipertahankan:
// bilah-bilahnya sudah terpasang, dan elemen mengambang berikutnya cukup membaca variable ini.
//
// Kenapa CSS variable, bukan context atau daftar route: bilah bisa berubah tinggi (mis. bilah
// checkout bertambah teks persetujuan, bilah keranjang berganti isi), dan halaman baru yang punya
// bilah bawah cukup memanggil hook ini tanpa mengubah komponen mengambangnya sama sekali.

import { useEffect, useRef } from 'react'

// Nama CSS variable — dibaca elemen mengambang yang perlu menghindari bilah aksi bawah.
export const STICKY_BAR_HEIGHT_VAR = '--sticky-bar-h'

// Mengembalikan ref yang harus dipasang pada elemen terluar bilah bawah.
// Tinggi elemen dipantau ResizeObserver; saat komponen dilepas (pindah halaman), variable direset
// ke 0 sehingga elemen mengambang kembali turun ke posisi normal.
//
// `enabled` untuk bilah yang hanya mengambang di sebagian breakpoint (mis. StickyBuyBar yang jadi
// statis di desktop): saat false, variable ditahan 0 supaya elemen mengambang tidak terangkat oleh
// bilah yang sebenarnya sudah ikut mengalir bersama konten.
export function useStickyBarHeight<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) {
      document.documentElement.style.setProperty(STICKY_BAR_HEIGHT_VAR, '0px')
      return
    }

    const root = document.documentElement
    const write = () => root.style.setProperty(STICKY_BAR_HEIGHT_VAR, `${el.offsetHeight}px`)

    write()
    const observer = new ResizeObserver(write)
    observer.observe(el)

    return () => {
      observer.disconnect()
      root.style.setProperty(STICKY_BAR_HEIGHT_VAR, '0px')
    }
  }, [enabled])

  return ref
}
