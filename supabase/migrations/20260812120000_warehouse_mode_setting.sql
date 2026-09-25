-- supabase/migrations/20260812120000_warehouse_mode_setting.sql
-- Memindahkan mode pergudangan dari environment variable ke DATABASE (store_settings).
--
-- KENAPA: mengubah mode lewat env berarti redeploy Vercel. Sebagai toko dengan satu developer,
-- tuas rollback harus bisa ditarik dari OMS kapan saja tanpa menyentuh kode maupun deployment.
-- Setelah migration ini, env WAREHOUSE_MODE TIDAK dibaca lagi oleh aplikasi (satu sumber kebenaran).
--
-- Tabel store_settings sudah dibuat di 20260810120000_add_min_order.sql — di sini hanya seed baris.
-- Nilai awal 'multi' sesuai keputusan bisnis 2026-08-11 (gudang cabang = mode resmi).
--
-- CATATAN: default_warehouse_id SENGAJA TIDAK diseed di sini. Gudang default sudah ditentukan
-- kolom warehouses.is_default yang dijaga index partial warehouses_single_default_idx (mustahil
-- ada dua default). Menyimpannya di dua tempat = dua sumber kebenaran yang bisa berbeda.

insert into public.store_settings (key, value)
values ('warehouse_mode', 'multi')
on conflict (key) do nothing;

-- Verifikasi (jalankan manual bila perlu):
--   select key, value, updated_at from public.store_settings order by key;
