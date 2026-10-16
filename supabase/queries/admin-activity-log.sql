-- supabase/queries/admin-activity-log.sql
-- Contoh query untuk membaca log aktivitas admin OMS (tabel public.admin_activity_log).
-- Tempel salah satu blok ke Supabase Dashboard → SQL Editor, ganti nilai di dalam tanda kutip.
-- Semua query HANYA membaca (SELECT). Tabel ini tak punya halaman OMS — inilah cara membacanya.
--
-- Isi kolom:
--   created_at   waktu aksi (UTC — query di bawah menampilkan WIB)
--   admin_name   pelaku (salinan nama saat aksi; tetap ada walau akunnya dihapus)
--   action       mis. order.status_update, refund.create, refund.xendit, shipment.cancel,
--                product.create/update/delete/bulk, review.create_manual/delete, setting.update,
--                stock.update, auth.login/login_failed/logout
--   entity_label sasaran yang mudah dibaca: nomor invoice, nama produk, nama pengaturan
--   details      rincian (JSON): field yang berubah sebelum → sesudah, alasan, jumlah, dsb.


-- 1. Riwayat SATU pesanan atau produk — "siapa membatalkan / me-refund INV-xxx?"
select created_at at time zone 'Asia/Jakarta' as waktu_wib,
       admin_name, action, details
  from public.admin_activity_log
 where entity_label = 'INV-20261016-QZ2ES9J3'   -- atau nama produk, mis. 'Hidroton 1 liter'
    or entity_id    = 'INV-20261016-QZ2ES9J3'
 order by created_at desc;


-- 2. Semua aksi SATU admin dalam rentang tanggal (WIB)
select created_at at time zone 'Asia/Jakarta' as waktu_wib,
       action, entity_type, entity_label, details
  from public.admin_activity_log
 where admin_name ilike '%sales%'                -- sebagian nama admin
   and created_at >= '2026-10-16 00:00+07'
   and created_at <  '2026-10-17 00:00+07'
 order by created_at desc;


-- 3. Aksi SENSITIF 7 hari terakhir: refund, pembatalan, penghapusan, pengaturan
select created_at at time zone 'Asia/Jakarta' as waktu_wib,
       admin_name, action, entity_label, details
  from public.admin_activity_log
 where created_at >= now() - interval '7 days'
   and (
         action in ('refund.create', 'refund.xendit', 'shipment.cancel', 'setting.update')
      or action like '%.delete'
      or (action = 'order.status_update' and details -> 'status' ->> 'after' = 'Dibatalkan')
   )
 order by created_at desc;


-- 4. Login GAGAL 7 hari terakhir, dikelompokkan per akun & IP — tanda tebak password
select entity_label as akun_dicoba,
       details ->> 'ip' as ip,
       count(*) as jumlah,
       max(created_at) at time zone 'Asia/Jakarta' as terakhir_wib
  from public.admin_activity_log
 where action = 'auth.login_failed'
   and created_at >= now() - interval '7 days'
 group by 1, 2
 order by jumlah desc;
