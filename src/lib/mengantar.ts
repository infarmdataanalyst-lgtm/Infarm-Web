// src/lib/mengantar.ts
// Helper sisi-klien untuk pencarian alamat Mengantar lewat proxy internal (/api/mengantar).
// Dipakai oleh search alamat di form checkout. _id hasil pilihan disimpan sebagai destination_id
// untuk dipakai pada langkah cek ongkir berikutnya.

// Satu hasil alamat Mengantar (field yang dipakai checkout)
export type MengantarAddress = {
  _id: string
  PROVINCE_NAME: string
  CITY_NAME: string
  DISTRICT_NAME: string
  SUBDISTRICT_NAME: string
  ZIP_CODE: string
}

// Mencari alamat berdasarkan keyword (kelurahan/kecamatan/kota). Mengembalikan daftar hasil.
// Pemanggil bertanggung jawab atas debounce & syarat minimal panjang keyword.
export async function searchAddress(
  keyword: string,
  signal?: AbortSignal,
): Promise<MengantarAddress[]> {
  const res = await fetch(`/api/mengantar/address/search?keyword=${encodeURIComponent(keyword)}`, {
    signal,
  })
  if (!res.ok) throw new Error('Gagal mencari alamat.')
  const data = (await res.json()) as { data: MengantarAddress[] }
  return data.data ?? []
}

// Mengubah teks UPPERCASE dari Mengantar menjadi Title Case agar enak dibaca
// (mis. 'JAWA BARAT' → 'Jawa Barat'). Hanya untuk tampilan, bukan nilai yang dikirim ke API.
export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
