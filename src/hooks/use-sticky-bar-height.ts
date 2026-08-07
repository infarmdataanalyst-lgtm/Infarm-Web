'use client'

// src/hooks/use-sticky-bar-height.ts
// Mendaftarkan tinggi sebuah bilah aksi bawah (sticky/fixed) ke CSS variable global
// `--sticky-bar-h` di elemen <html>. Elemen mengambang lain (mis. FloatingWhatsApp) memakai
// variable itu untuk menaikkan posisinya supaya tidak tertimpa/menimpa bilah tersebut.
//
// Kenapa CSS variable, bukan context atau daftar route: bilah bisa berubah tinggi (mis. bilah
// checkout bertambah teks persetujuan, bilah keranjang berganti isi), dan halaman baru yang punya
// bilah bawah cukup memanggil hook ini tanpa mengubah komponen mengambangnya sama sekali.

import { useEffect, useRef } from 'react'

// Nama CSS variable — dipakai bersama FloatingWhatsApp.
export const STICKY_BAR_HEIGHT_VAR = '--sticky-bar-h'

// Mengembalikan ref yang harus dipasang pada elemen terluar bilah bawah.
// Tinggi elemen dipantau ResizeObserver; saat komponen dilepas (pindah halaman), variable direset
// ke 0 sehingga elemen mengambang kembali turun ke posisi normal.
export function useStickyBarHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const root = document.documentElement
    const write = () => root.style.setProperty(STICKY_BAR_HEIGHT_VAR, `${el.offsetHeight}px`)

    write()
    const observer = new ResizeObserver(write)
    observer.observe(el)

    return () => {
      observer.disconnect()
      root.style.setProperty(STICKY_BAR_HEIGHT_VAR, '0px')
    }
  }, [])

  return ref
}
