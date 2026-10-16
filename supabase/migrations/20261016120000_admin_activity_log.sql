-- supabase/migrations/20261016120000_admin_activity_log.sql
-- Log aktivitas admin OMS: satu baris per aksi yang MENGUBAH data (batalkan pesanan, refund, ubah
-- produk, ubah pengaturan, login, dst). Tujuannya menjawab "siapa melakukan apa, kapan" saat ada
-- kejadian yang perlu ditelusuri.
--
-- ── Dibaca langsung di database, TANPA halaman OMS ──
-- Sengaja tak ada UI: yang membaca hanya pemilik/dev lewat Supabase Dashboard (Table Editor atau
-- SQL Editor). Contoh query siap pakai ada di supabase/queries/admin-activity-log.sql.
--
-- ── Ditulis dari aplikasi, bukan trigger ──
-- Sama dengan stock_mutations: admin OMS tidak memakai Supabase Auth (tabel public.admin_users +
-- cookie sesi HMAC), jadi trigger database tak tahu siapa pelakunya. Titik pencatatannya
-- src/lib/admin-activity.ts, dipanggil route handler setelah aksinya berhasil.
--
-- ── Hubungan dengan stock_mutations ──
-- Perubahan stok tetap dicatat per sel di stock_mutations. Di sini hanya ringkasan aksinya
-- (mis. "admin A mengubah 3 sel stok"), supaya dua tabel tak saling menggandakan.
--
-- ── Snapshot & FK ──
-- admin_id ON DELETE SET NULL + admin_name/admin_role sebagai salinan teks, dan entity_label
-- (nomor invoice, nama produk) sebagai salinan teks: log tetap terbaca setelah akun admin atau
-- sasaran aksinya dihapus. entity_id sengaja TEXT tanpa FK — sasarannya bisa tabel mana saja.

create table if not exists public.admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Pelaku. NULL hanya untuk login gagal (belum ada admin yang terautentikasi).
  admin_id uuid references public.admin_users(id) on delete set null,
  admin_name text,
  admin_role text,

  -- Format "<sasaran>.<aksi>", mis. 'order.status_update', 'refund.create', 'auth.login_failed'.
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),

  -- Sasaran aksi. entity_type mis. 'order', 'product', 'setting'; entity_label snapshot yang
  -- mudah dibaca manusia (nomor invoice, nama produk, nama pengaturan).
  entity_type text not null,
  entity_id text,
  entity_label text,

  -- Hanya yang relevan: field yang berubah (sebelum → sesudah), alasan, jumlah & daftar SKU untuk
  -- aksi massal. Field rahasia (password, token, key) dibuang aplikasi sebelum ditulis.
  details jsonb not null default '{}'::jsonb
);

-- "Apa saja yang terjadi minggu ini" → urut terbaru.
create index if not exists admin_activity_log_created_at_idx
  on public.admin_activity_log (created_at desc);

-- "Semua aksi admin B".
create index if not exists admin_activity_log_admin_idx
  on public.admin_activity_log (admin_id, created_at desc);

-- "Riwayat pesanan / produk X".
create index if not exists admin_activity_log_entity_idx
  on public.admin_activity_log (entity_type, entity_id, created_at desc);

-- Data operasional internal → RLS aktif TANPA policy: anon & authenticated tak bisa menyentuhnya.
alter table public.admin_activity_log enable row level security;
revoke all on public.admin_activity_log from anon, authenticated;

-- Log hanya boleh BERTAMBAH. Sejak SEC-055 tabel baru tak otomatis terbuka untuk service_role
-- (lihat supabase/README.md), jadi izinnya ditulis di sini — sengaja HANYA select & insert, tanpa
-- update/delete seperti pola default proyek: admin yang aksesnya bocor tak bisa menghapus jejaknya
-- lewat aplikasi. Pembersihan data lama (bila suatu saat perlu) dilakukan pemilik dari SQL Editor.
revoke update, delete, truncate on public.admin_activity_log from service_role;
grant select, insert on public.admin_activity_log to service_role;

comment on table public.admin_activity_log is
  'Log aktivitas admin OMS (hanya aksi yang mengubah data). Ditulis aplikasi lewat src/lib/admin-activity.ts, append-only, dibaca dari Dashboard — tak ada UI. Contoh query: supabase/queries/admin-activity-log.sql.';

-- === Setelah menjalankan file ini di SQL Editor, catat juga (SEC-036) ===
--
--     insert into public.schema_migrations (version, note) values
--       ('20261016120000_admin_activity_log', 'tabel log aktivitas admin OMS (append-only, tanpa UI)')
--     on conflict (version) do nothing;
