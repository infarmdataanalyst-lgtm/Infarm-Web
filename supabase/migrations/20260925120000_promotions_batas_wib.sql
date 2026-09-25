-- supabase/migrations/20260925120000_promotions_batas_wib.sql
-- Geser batas periode promo LAMA dari "tengah malam UTC" ke "tengah malam WIB".
--
-- Sampai PR ini, formulir promo OMS mengirim tanggal tanpa zona waktu ("2026-09-26T00:00:00"),
-- dan Postgres (sesi UTC) menyimpannya sebagai 00.00 UTC = 07.00 WIB. Akibatnya:
--   start_at "26 Sep"  → promo baru aktif 26 Sep 07.00 WIB (seharusnya 00.00 WIB)
--   end_at   "30 Sep"  → promo masih berlaku sampai 1 Okt 06.59 WIB (seharusnya 30 Sep 23.59 WIB)
-- Formulir kini mengirim "+07:00". Baris lama dikoreksi di sini: mundur 7 jam.
--
-- Hanya baris yang jamnya PERSIS pola lama (00:00:00 / 23:59:59 UTC) yang disentuh, jadi aman
-- dijalankan ulang: setelah digeser jamnya menjadi 17:00:00 / 16:59:59 UTC dan tak cocok lagi.

update public.promotions
set start_at = start_at - interval '7 hours'
where start_at is not null
  and (start_at at time zone 'UTC')::time = time '00:00:00';

update public.promotions
set end_at = end_at - interval '7 hours'
where end_at is not null
  and (end_at at time zone 'UTC')::time = time '23:59:59';
