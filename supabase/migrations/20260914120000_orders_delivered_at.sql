-- 20260914120000_orders_delivered_at.sql
-- Menambah orders.delivered_at — kapan KURIR menyatakan paket diterima.
--
-- KENAPA KOLOM BARU, BUKAN MEMAKAI order_status = 'COMPLETED':
-- 'Selesai' adalah status FINAL di state machine (tak ada transisi keluar) dan tak bisa
-- dibatalkan lewat UI mana pun — hanya SQL. Karena itu ia SENGAJA tak pernah ditulis otomatis
-- (AUTO_ADVANCE_MAX_STEP = 2 di src/lib/tracking.ts): satu scan kurir yang keliru akan mengunci
-- pesanan selamanya, dan 'Selesai' juga menghentikan sinkronisasi resi sehingga paket yang
-- ternyata RETUR ke pengirim berhenti terpantau.
--
-- Akibatnya hak ulas pembeli dulu menggantung pada admin yang menandai satu per satu. Kolom ini
-- memisahkan keduanya: `delivered_at` memberi hak ulas secara otomatis, sementara `order_status`
-- tetap urusan administratif yang dikendalikan manusia. Tak ada yang terkunci, tak ada yang
-- berhenti terpantau, dan pembeli tak menunggu siapa pun.
--
-- ISINYA WAKTU KITA MENGAMATI, BUKAN WAKTU KLAIM KURIR. Mengantar mengirim timestamp peristiwa
-- sebagai teks bebas ("25 Jun 2026 08:32pm") yang sengaja tidak pernah diparse aplikasi ini, dan
-- di sandbox seluruh riwayatnya adalah data contoh bertanggal jauh sebelum pesanannya dibuat.
-- Memakai waktu pengamatan selalu lebih lambat daripada penerimaan sesungguhnya, jadi jendela
-- ulasan tak pernah tertutup lebih awal daripada seharusnya.
--
-- Diisi oleh tiga pemicu yang saling menutupi: halaman /track saat pembeli membukanya,
-- sinkronisasi resi di halaman Pesanan OMS, dan cron harian sebagai jaring pengaman.
-- Penulisannya dijaga `where delivered_at is null` — scan PERTAMA yang mengunci tanggalnya,
-- supaya sinkronisasi berulang tidak menggeser tenggat ulasan maju terus.

alter table public.orders
  add column if not exists delivered_at timestamptz;

comment on column public.orders.delivered_at is
  'Kapan kurir menyatakan paket diterima (waktu PENGAMATAN kita, bukan klaim kurir). Memberi hak ulas selama 14 hari. Terpisah dari order_status = COMPLETED yang tetap manual dan final.';

-- Partial index: yang dicari selalu baris yang BELUM punya tanggal terima (kandidat sinkronisasi),
-- dan itu bagian yang menyusut seiring waktu. Mengindeks baris yang sudah terisi tak ada gunanya —
-- tak ada satu pun query yang menyaring berdasarkan nilainya.
create index if not exists orders_delivered_at_null_idx
  on public.orders (created_at)
  where delivered_at is null;

-- Wajib dicatat di ledger (SEC-036) — tanpa CLI, ini satu-satunya bukti tertulis bahwa file ini
-- benar-benar pernah dijalankan.
insert into public.schema_migrations (version, note)
values ('20260914120000_orders_delivered_at', 'dijalankan manual')
on conflict (version) do nothing;
