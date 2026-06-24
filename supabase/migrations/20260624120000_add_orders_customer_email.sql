-- supabase/migrations/20260624120000_add_orders_customer_email.sql
-- Menambah kolom email pelanggan ke tabel orders (untuk kirim konfirmasi pesanan ke buyer).
-- Tipe TEXT (sesuai panduan: email disimpan sebagai teks lowercase tanpa simbol khusus).
-- Dijalankan via Dashboard -> SQL Editor (sama seperti migration lain di folder ini).

alter table public.orders
  add column if not exists customer_email text;

-- Catatan: kode aplikasi (mock-db/orders.ts) punya fallback aman bila kolom ini belum ada,
-- jadi checkout tetap berjalan; email baru ikut tersimpan setelah migration ini diterapkan.
