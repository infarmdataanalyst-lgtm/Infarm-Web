-- supabase/migrations/20260901120000_nonaktifkan_kredensial_admin_bocor.sql
-- Menonaktifkan kredensial admin OMS yang bocor lewat Git (temuan SEC-011 / audit 07-24 K4).
--
-- Latar: migration 20260708120000 versi awal men-seed akun OMS pertama dengan password lemah
-- BESERTA hash-nya, keduanya tertulis polos di file yang ikut ter-commit. Siapa pun yang pernah
-- memegang salinan repo memegang kredensial back-office berfungsi penuh.
--
-- Migration ini untuk database yang PASSWORDNYA BELUM DIROTASI (mis. staging, atau database yang
-- baru dipulihkan dari backup lama). Pada database yang sudah dirotasi, WHERE-nya tidak cocok dan
-- migration ini tidak melakukan apa-apa — aman dijalankan berkali-kali.
--
-- Yang dicocokkan SIDIK JARI SHA-256 dari password_hash, bukan hash aslinya. Sengaja: menulis hash
-- yang bocor ke file yang ikut ter-commit adalah persis kesalahan yang sedang diperbaiki di sini.
--
-- 'DISABLED' dipilih karena tidak punya pemisah ':' sehingga verifyPassword
-- (src/lib/mock-db/admins.ts) menolaknya sebelum sempat menghitung apa pun — bukan sekadar
-- password yang sulit ditebak, tapi nilai yang secara format mustahil lolos.

update public.admin_users
set password_hash = 'DISABLED',
    is_active     = false
where encode(sha256(password_hash::bytea), 'hex')
      = '80348f571c757ae8021f21f59f331228034c7d02ba7be99510ab5fb24eb2d797';

-- Setelah ini akunnya nonaktif dan tanpa password yang bisa dipakai. Cara mengaktifkan kembali
-- dengan password baru ada di komentar bawah supabase/migrations/20260708120000_init_admin_users.sql.
--
-- Lapisan kedua ada di aplikasi: KNOWN_COMPROMISED_HASHES di src/lib/mock-db/admins.ts menolak
-- login dari hash ini walau migration ini belum sempat dijalankan, atau walau hash lamanya kembali
-- lewat restore backup.
