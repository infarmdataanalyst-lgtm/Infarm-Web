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

-- === Seed admin awal — SENGAJA TANPA PASSWORD YANG BISA DIPAKAI ===
--
-- Versi awal file ini men-seed akun ini dengan password default yang lemah beserta hash-nya, keduanya
-- tertulis polos di sini dan ikut ter-commit ke Git (temuan SEC-011 / audit 07-24 K4). Artinya
-- siapa pun yang pernah memegang salinan repo ini memegang kredensial back-office yang berfungsi
-- penuh: kelola produk, order, harga, dan stok. Kredensial itu sudah dirotasi di database dan
-- DIBLOKIR PERMANEN di lapisan aplikasi (lihat KNOWN_COMPROMISED_HASHES di
-- src/lib/mock-db/admins.ts) — hash lamanya tidak akan pernah diterima lagi walaupun muncul
-- kembali dari backup atau dari riwayat Git.
--
-- Karena itu seed di bawah membuat akun dalam keadaan NONAKTIF dengan password_hash yang secara
-- format tidak mungkin lolos verifikasi ('DISABLED' tak punya pemisah ':', jadi verifyPassword
-- menolaknya lebih dulu). Instalasi baru tidak mendapat kredensial default apa pun — passwordnya
-- harus diberikan sendiri oleh operator lewat langkah di bawah.
--
-- ATURAN: jangan pernah menaruh password (plaintext MAUPUN hash-nya) di file yang ikut ter-commit.
insert into public.admin_users (username, password_hash, name, is_active)
values ('admin@infarm.id', 'DISABLED', 'Admin Infarm', false)
on conflict (username) do nothing;

-- === Mengaktifkan akun / mengganti password (dijalankan manual, JANGAN di-commit) ===
-- 1. Di mesin dev, buat hash dari password kuat yang kamu pilih sendiri:
--      node -e "const{scryptSync,randomBytes}=require('node:crypto');const s=randomBytes(16);const h=scryptSync('PASSWORD_BARU',s,64);console.log(s.toString('hex')+':'+h.toString('hex'))"
-- 2. Tempel HASH-nya saja di SQL Editor Supabase (passwordnya jangan ikut berpindah):
--      update public.admin_users
--      set password_hash = '<hash_baru>', is_active = true
--      where username = 'admin@infarm.id';
-- 3. Simpan passwordnya di password manager — bukan di repo, catatan, atau chat.
