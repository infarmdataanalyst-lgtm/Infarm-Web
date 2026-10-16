// src/lib/admin-activity.ts
// Satu pintu untuk MENCATAT aksi admin OMS ke tabel admin_activity_log. SERVER ONLY.
//
// Dipanggil route handler SETELAH aksinya berhasil — aksi yang ditolak (validasi, 403, 409) tak
// dicatat, kecuali login gagal. Hanya aksi yang mengubah data; route baca tak memanggil ini.
//
// BEST EFFORT, pola sama dengan stock-audit.ts: kegagalan mencatat tak pernah dilempar ke
// pemanggil. Pesanan yang sudah dibatalkan atau refund yang sudah terkirim tak boleh berubah
// menjadi respons galat hanya karena satu baris log gagal ditulis. Pemanggil tak perlu try/catch.
//
// Tak ada UI: log dibaca pemilik lewat Supabase Dashboard (contoh: supabase/queries/admin-activity-log.sql).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminIdentity } from '@/lib/oms-guard'
import type { AdminIdentity } from '@/lib/mock-db/admins'
import { sanitizeActivityDetails } from '@/lib/admin-activity-details'

export { diffFields } from '@/lib/admin-activity-details'

// Kode error saat tabel belum di-migrate (pola sama dengan mock-db/stock-mutations.ts) — sebelum
// migration 20261016120000 dijalankan, pencatatan diam saja alih-alih memenuhi log server.
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST204', '42P01', '42703'])

// Daftar aksi yang dicatat. Ditulis sebagai union supaya nama aksi konsisten di seluruh route —
// query di Dashboard memfilter berdasarkan string ini, jadi salah ketik = baris yang "hilang".
export type AdminActivityAction =
  // Akun
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  // Pesanan & pengiriman
  | 'order.status_update'
  | 'order.backfill_mengantar_ids'
  | 'shipment.cancel'
  | 'refund.create'
  | 'refund.xendit'
  // Produk & varian
  | 'product.create'
  | 'product.update'
  | 'product.delete'
  | 'product.bulk'
  | 'variant.create'
  | 'variant.update'
  | 'variant.delete'
  // Promo & combo
  | 'promotion.create'
  | 'promotion.update'
  | 'promotion.delete'
  | 'promotion.toggle'
  | 'combo.create'
  | 'combo.update'
  | 'combo.delete'
  | 'combo.toggle'
  // Ulasan
  | 'review.create_manual'
  | 'review.delete'
  | 'review.reply'
  | 'review.visibility'
  // Gudang & stok
  | 'warehouse.create'
  | 'warehouse.update'
  | 'warehouse.delete'
  | 'warehouse.toggle'
  | 'warehouse.set_default'
  | 'stock.update'
  // Pengaturan
  | 'setting.update'

export type AdminActivityInput = {
  action: AdminActivityAction
  // Jenis sasaran: 'order', 'product', 'setting', dst.
  entityType: string
  entityId?: string | null
  // Snapshot yang mudah dibaca: nomor invoice, nama produk, nama pengaturan.
  entityLabel?: string | null
  details?: Record<string, unknown>
  // Untuk route yang sudah memegang identitas (mis. login) — menghemat satu baca admin_users.
  // `null` = sengaja tanpa pelaku (login gagal). Tak diisi = dibaca dari cookie sesi.
  actor?: AdminIdentity | null
}

export async function logAdminActivity(input: AdminActivityInput): Promise<void> {
  try {
    const actor = input.actor === undefined ? await getAdminIdentity() : input.actor

    const supabase = createAdminClient()
    const { error } = await supabase.from('admin_activity_log').insert({
      admin_id: actor?.id ?? null,
      admin_name: actor?.name ?? null,
      admin_role: actor?.role ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      details: sanitizeActivityDetails(input.details),
    })

    if (error && !(error.code && MISSING_SCHEMA_CODES.has(error.code))) {
      console.error(`Gagal mencatat log aktivitas admin (${input.action}):`, error.message)
    }
  } catch (err) {
    console.error(
      `Gagal mencatat log aktivitas admin (${input.action}):`,
      err instanceof Error ? err.message : err,
    )
  }
}
