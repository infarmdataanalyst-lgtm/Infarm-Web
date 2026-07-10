# Template Checklist Audit Keamanan Berkala — infarm.id

Salin file ini jadi `audit-YYYY-MM-DD.md` saat memulai audit baru, isi tiap butir, lalu update
kolom **Status** di [README.md](README.md). Tujuannya cakupan audit selalu konsisten antar-siklus.

- **Tanggal audit:** ____
- **Auditor:** ____
- **Commit/branch yang diaudit:** ____  (`git rev-parse --short HEAD`)
- **Sifat:** read-only (jangan ubah kode saat fase audit)

> Sebelum mulai: baca `CLAUDE.md` + register `README.md` (fokus temuan yang masih 🔴/🟡).
> Wajib audit ulang **setiap kali menambah endpoint API baru** (contoh: penambahan combo/promosi
> membuat cakupan K-1 membesar tanpa terdeteksi sampai audit berikutnya).

---

## 1. Injection & Input Validation
- [ ] Semua query Supabase pakai query builder (`.eq/.select/.insert/.update/.rpc`), tanpa string concat. `grep -rn "\.rpc(\|raw(\|execute" src/lib`
- [ ] Fungsi SQL/RPC di `supabase/migrations/*.sql` tanpa dynamic SQL/`format()`/`EXECUTE`.
- [ ] Setiap endpoint mutasi (`orders/create`, `products/*`, `combos/*`, `promotions/*`, `reviews/*`) memvalidasi **server-side** (bukan cuma client). Format email/telepon/alamat dicek di server.
- [ ] Upload gambar: ukuran + MIME + skema data-URL divalidasi server-side.

## 2. XSS
- [ ] `grep -rn "dangerouslySetInnerHTML\|innerHTML" src` → nihil.
- [ ] Teks user (review, nama, alamat, deskripsi) dirender via JSX (auto-escape).
- [ ] Template email: placeholder `{{ }}` di-HTML-escape sebelum dikirim (bukan `split/join` mentah).

## 3. Autentikasi & Otorisasi
- [ ] `grep -rn "verifySessionToken\|OMS_SESSION_COOKIE\|requireAdmin" src/app/api` → **setiap** route mutasi OMS + `orders/list` memverifikasi sesi admin. (Ini pengecekan inti — K-1.)
- [ ] `src/proxy.ts` matcher mencakup halaman & (idealnya) API OMS.
- [ ] Login: rate limit efektif (bukan cuma in-memory), tak percaya `X-Forwarded-For` mentah, error generik.
- [ ] Kredensial seed bukan default lemah (`admin123`), sudah dirotasi.
- [ ] Endpoint guest (`orders/get`, `orders/cancel`, `reviews/create`) diproteksi token/verifikasi kepemilikan.

## 4. RLS (per tabel Supabase)
- [ ] Tiap tabel: RLS **ON** + policy sesuai. Verifikasi di DB live (bukan cuma repo):
      `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace;`
- [ ] Tabel PII (`orders`, `order_items`, `admin_users`) terkunci dari `anon`.
- [ ] Migration di repo **cocok** dengan skema live (tak ada schema drift / tabel dibuat manual tanpa migration).
- [ ] "Auto-expose new tables" di Data API dimatikan.

## 5. Sensitive Data Exposure
- [ ] `SUPABASE_SERVICE_ROLE_KEY` & secret lain (`OMS_SESSION_SECRET`, `ORDER_CANCEL_SECRET`, `XENDIT_*`, `MENGANTAR_API_KEY`) tak diimpor komponen `'use client'`. Telusuri import graph.
- [ ] Tak ada secret hardcoded; fallback dev tak dipakai di produksi (fail-fast bila kosong).
- [ ] `NEXT_PUBLIC_*` hanya untuk nilai yang memang boleh publik.
- [ ] Respons GET tak membocorkan PII pelanggan lain.
- [ ] `.env*` di-`.gitignore`; tak ada file env ter-track.

## 6. CSRF / CORS / Headers
- [ ] Route mutasi: proteksi CSRF (cek `Origin`/`Referer` atau token) + `SameSite` cookie tepat.
- [ ] `grep -rn "Access-Control-Allow" src/app/api` → tak ada wildcard CORS di endpoint sensitif.
- [ ] `next.config.ts` menyetel: CSP, `X-Frame-Options`/`frame-ancestors`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`.

## 7. Broken Access Control / Business Logic
- [ ] IDOR: `orders/get`/`cancel` tak bisa dienumerasi (invoice tak tertebak / wajib token).
- [ ] Harga & total order **dihitung ulang server-side dari DB**, bukan dari client.
- [ ] Stok divalidasi atomik server-side (`SELECT … FOR UPDATE`), tak bisa oversell.
- [ ] Promo/diskon divalidasi server (aktif, belum kedaluwarsa, `min_purchase`, nilai diskon) saat order dibuat.

## 8. Dependency & Misc
- [ ] `npm audit` (online) — catat jumlah per severity + apakah fix tersedia.
- [ ] Route dev (`/dev/*`) di-gate agar tidak aktif di produksi.
- [ ] Endpoint proxy pihak ketiga (Mengantar) di-rate-limit.
- [ ] Ada audit log untuk aksi admin/pembatalan (OWASP #9).

---

## Format tiap temuan (untuk snapshot)
```
### <ID> · <Judul>
- Kategori: <OWASP / jenis>
- Lokasi: <file:line>
- Severity: Kritis / Tinggi / Sedang / Rendah
- Masalah: <apa yang salah + kenapa berbahaya>
- Rekomendasi: <garis besar perbaikan>
```
- Pakai **ID stabil** dari register; temuan baru → nomor lanjutan (jangan daur ulang).
- Urutkan dari severity tertinggi.
- Setelah selesai: update kolom **Status** & **Terakhir diverifikasi** di `README.md`, tambah baris di **Log progres**.
