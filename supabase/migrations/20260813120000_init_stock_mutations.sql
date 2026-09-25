-- supabase/migrations/20260813120000_init_stock_mutations.sql
-- Riwayat mutasi stok: satu baris per perubahan stok di satu gudang.
--
-- Dicatat dari lapisan aplikasi (bukan trigger database) agar mudah di-debug oleh solo dev dan
-- agar "siapa yang mengubah" bisa diambil dari sesi admin OMS. Titik pencatatan:
--   manual_update  → halaman OMS "Kelola Stok Gudang" (edit sel matrix)
--   product_form   → stok awal saat produk dibuat / diubah lewat form produk
--   order          → stok berkurang karena pesanan masuk (setelah RPC create_order_with_items sukses)
--   order_cancelled→ stok kembali karena pesanan dibatalkan
--
-- CATATAN PENTING soal FK:
-- Brief awal menulis `changed_by uuid references auth.users(id)`. Itu TIDAK bisa dipakai di project
-- ini — admin OMS TIDAK memakai Supabase Auth (tabel auth.users tak dipakai), melainkan tabel
-- public.admin_users + cookie sesi HMAC. Jadi FK-nya mengarah ke admin_users(id).
--
-- Semua FK memakai ON DELETE SET NULL, BUKAN restrict/cascade:
--   restrict → menghapus produk (termasuk aksi massal di halaman Produk) akan gagal begitu
--              produk itu punya riwayat;
--   cascade  → jejak audit ikut hilang justru saat paling dibutuhkan.
-- Karena itu nama produk/varian/gudang dan nomor invoice disimpan sebagai SNAPSHOT teks, sehingga
-- riwayat tetap terbaca setelah barisnya dihapus (pola sama dengan order_items & product_combo_items).

create table if not exists public.stock_mutations (
  id uuid primary key default gen_random_uuid(),

  -- Sasaran perubahan. variant_id NULL = stok produk tanpa varian (selaras
  -- product_stock_per_warehouse yang juga memakai variant_id nullable).
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,

  -- Snapshot nama agar riwayat tetap bisa dibaca setelah produk/varian/gudang dihapus.
  product_name text not null,
  variant_name text,
  warehouse_name text not null,

  -- Pelaku perubahan. NULL untuk perubahan yang dipicu pembeli (pesanan masuk / pembatalan
  -- oleh pembeli lewat storefront) — di situ tak ada admin yang bertanggung jawab.
  changed_by uuid references public.admin_users(id) on delete set null,
  changed_by_name text,

  -- Stok sebelum & sesudah. Selalu INTEGER (stok tak pernah pecahan).
  stok_before integer not null,
  stok_after integer not null,

  reason text not null default 'manual_update'
    check (reason in ('manual_update', 'product_form', 'order', 'order_cancelled')),

  -- Pesanan pemicu (untuk reason order / order_cancelled). Invoice ikut disnapshot supaya
  -- riwayat tetap menyebut nomor pesanan walau barisnya hilang.
  order_id uuid references public.orders(id) on delete set null,
  order_invoice text,

  created_at timestamptz not null default now()
);

-- Halaman Riwayat Mutasi menampilkan urutan kronologis terbaru → index turun di created_at.
create index if not exists stock_mutations_created_at_idx
  on public.stock_mutations (created_at desc);

-- Untuk melihat riwayat satu produk (tautan "riwayat" per baris di matrix Kelola Stok).
create index if not exists stock_mutations_product_idx
  on public.stock_mutations (product_id, created_at desc);

-- Riwayat stok = data operasional (mengungkap volume penjualan & sebaran gudang).
-- RLS aktif TANPA policy publik → hanya bisa dibaca/ditulis server lewat service_role.
alter table public.stock_mutations enable row level security;

comment on table public.stock_mutations is
  'Riwayat perubahan stok per gudang. Ditulis dari aplikasi (bukan trigger). FK ON DELETE SET NULL + snapshot nama agar riwayat selamat saat produk/gudang dihapus.';
