// src/lib/notification-groups.ts
// Pengelompokan notifikasi OMS untuk tab di panel lonceng & halaman /oms/dashboard/notifikasi.
// Modul MURNI (tanpa DB/fetch) — dipakai server (penyaringan di API) maupun komponen client (label).
//
// ── Kenapa ada ──
// Panel lonceng global dan diurutkan "pesanan bermasalah dulu, lalu terbaru". Saat ada puluhan
// peringatan pesanan (mis. uji kurir), produk yang kehabisan stok tenggelam jauh di bawah — tak
// terlihat justru dari halaman Produk tempat admin mencarinya (pemilik, 6 Okt 2026). Tab per jenis
// membiarkan urutan itu apa adanya, tapi memberi jalan langsung ke satu jenis peringatan.

// Sejajar dengan NotificationType di lib/mock-db/notifications.ts.
export type NotificationTypeKey = 'stok_habis' | 'ulasan_baru' | 'pesanan_bermasalah' | 'stok_hadiah'

export type NotificationGroup = 'semua' | 'pesanan' | 'stok' | 'ulasan'

// Urutan tab di layar.
export const NOTIFICATION_GROUPS: { key: NotificationGroup; label: string }[] = [
  { key: 'semua', label: 'Semua' },
  { key: 'pesanan', label: 'Pesanan' },
  { key: 'stok', label: 'Stok' },
  { key: 'ulasan', label: 'Ulasan' },
]

// Kelompok sebuah jenis notifikasi. Stok hadiah promo ikut "Stok": tindakannya sama — isi stok.
export function groupOfType(type: NotificationTypeKey): Exclude<NotificationGroup, 'semua'> {
  if (type === 'pesanan_bermasalah') return 'pesanan'
  if (type === 'ulasan_baru') return 'ulasan'
  return 'stok'
}

// Nilai `?jenis=` dari URL. Nilai tak dikenal jatuh ke 'semua' — URL lama/bookmark tetap jalan.
export function parseNotificationGroup(value: string | null | undefined): NotificationGroup {
  return NOTIFICATION_GROUPS.some((g) => g.key === value) ? (value as NotificationGroup) : 'semua'
}

// Jumlah notifikasi per tab. 'semua' = seluruhnya.
export function countByGroup(
  items: { type: NotificationTypeKey }[],
): Record<NotificationGroup, number> {
  const counts: Record<NotificationGroup, number> = { semua: items.length, pesanan: 0, stok: 0, ulasan: 0 }
  for (const item of items) counts[groupOfType(item.type)] += 1
  return counts
}

// Menyaring daftar ke satu tab, tanpa mengubah urutannya.
export function filterByGroup<T extends { type: NotificationTypeKey }>(
  items: T[],
  group: NotificationGroup,
): T[] {
  return group === 'semua' ? items : items.filter((item) => groupOfType(item.type) === group)
}
