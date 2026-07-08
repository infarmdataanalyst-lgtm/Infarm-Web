-- supabase/migrations/20260708120000_init_admin_users.sql
-- Tabel akun admin OMS (menggantikan login dummy hardcode).
-- Autentikasi diverifikasi di server (src/lib/mock-db/admins.ts) memakai hash scrypt.
-- password_hash berformat "saltHex:hashHex" (scrypt, keylen 64).
--
-- RLS diaktifkan TANPA policy publik → tabel terkunci dari anon/browser.
-- Akses hanya lewat server via service_role (createAdminClient), menembus RLS.
-- Dijalankan via Dashboard -> SQL Editor, urut sesuai timestamp.

create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,          -- email kerja / username login
  password_hash text not null,                 -- format: "saltHex:hashHex" (scrypt)
  name          text,                          -- nama tampilan admin
  is_active     boolean not null default true, -- nonaktifkan akun tanpa menghapus
  created_at    timestamptz not null default now()
);

comment on table public.admin_users is
  'Akun admin OMS. Password hash scrypt (saltHex:hashHex). Akses server-only via service_role.';

alter table public.admin_users enable row level security;
-- (Sengaja tanpa policy: anon/browser tak boleh baca/tulis; semua akses lewat server.)

-- === Seed admin awal ===
-- Username: admin@infarm.id
-- Password: admin123   <-- GANTI setelah login pertama (lihat cara ganti di bawah).
insert into public.admin_users (username, password_hash, name)
values (
  'admin@infarm.id',
  '9ea6b945bf0bd73c96d54e0b33c90ca9:576a7d92df207d657e2a8bc06ec81abedeab0c64f3da88f1e414592b2aa7b6d57a895ab822255a20a6148adab00dce4e169a22155a2a54568aad9d44a2cf024d',
  'Admin Infarm'
)
on conflict (username) do nothing;

-- === Cara ganti password (jalankan di mesin dev, lalu UPDATE hash-nya) ===
--   node -e "const{scryptSync,randomBytes}=require('node:crypto');const s=randomBytes(16);const h=scryptSync('PASSWORD_BARU',s,64);console.log(s.toString('hex')+':'+h.toString('hex'))"
--   update public.admin_users set password_hash = '<hash_baru>' where username = 'admin@infarm.id';
