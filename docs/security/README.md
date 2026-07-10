# Register Keamanan — infarm.id (Ecommerce + OMS)

**Sumber kebenaran status temuan keamanan.** File ini = register HIDUP: setiap audit hanya
meng-*update* kolom **Status** & **Terakhir diverifikasi**. Jangan pernah mendaur ulang ID —
temuan baru memakai nomor lanjutan. Detail lengkap tiap audit ada di snapshot bertanggal
(`audit-YYYY-MM-DD.md`) yang bersifat arsip (tidak diubah setelah dibuat).

- **Cakupan:** OWASP Top 10 + kerentanan umum web app.
- **ID stabil:** prefix = severity saat ditemukan (K=Kritis, T=Tinggi, S=Sedang, R=Rendah).
- **Kadens audit:** tiap rilis besar / bulanan, **dan wajib** setelah menambah endpoint API baru.

## Riwayat audit
- **2026-07-08** — audit awal (read-only). Snapshot: [audit-2026-07-08.md](audit-2026-07-08.md).
- **2026-07-10** — audit ulang (5 area paralel) + `npm audit` (online). Snapshot: [audit-2026-07-10.md](audit-2026-07-10.md).

## Log progres
- **2026-07-08** — K-4 diperbaiki (login DB-backed + sesi HMAC httpOnly di `proxy.ts`); T-2 & S-4 sebagian.
- **2026-07-10** — audit ulang: tidak ada temuan baru yang *diselesaikan* sejak 07-08.
  Cakupan **K-1 bertambah** (endpoint `combos/*` & `promotions/*` baru ikut tak terproteksi).
  **R-2 tuntas dijalankan** (3 moderate). Temuan baru: **T-3, S-5, S-6, S-7, R-5**.
- **2026-07-10** — **K-1 & K-2 diperbaiki**: helper `requireAdmin()` (`src/lib/oms-guard.ts`,
  verifikasi cookie sesi HMAC) dipasang di 14 endpoint OMS — semua route mutasi
  `products/combos/promotions/reviews` + `GET /api/orders/list` kini balas `401` tanpa sesi admin.
  Verifikasi: `tsc`+`eslint` lolos; grep konfirmasi 14 endpoint memakai guard. **Sekaligus menutup
  S-4 (bagian `reviews/reply` admin-only) & menurunkan R-3 (endpoint tak lagi anonim).**
  Menyusul: guard endpoint baca OMS-only lain (`combos/list`, `promotions/list`, `products/check-sku`).

---

## Status temuan

Legenda status: 🔴 Terbuka · 🟡 Sebagian · ✅ Selesai · ⚪ Diterima/roadmap

| ID | Judul | Severity | Status | Ditemukan | Terakhir diverifikasi | Lokasi utama |
|----|-------|----------|--------|-----------|-----------------------|--------------|
| **K-1** | Endpoint API OMS tanpa auth (14 endpoint) | Kritis | ✅ Selesai (07-10) | 2026-07-08 | 2026-07-10 | `src/lib/oms-guard.ts`, 14 route `src/app/api/**` |
| **K-2** | `GET /api/orders/list` bocor PII semua pelanggan | Kritis | ✅ Selesai (07-10) | 2026-07-08 | 2026-07-10 | `src/app/api/orders/list/route.ts` (requireAdmin) |
| **K-3** | Harga & total dipercaya dari client | Kritis | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/app/api/orders/create/route.ts`, `src/lib/mock-db/orders.ts` |
| **K-4** | Sesi OMS gampang dipalsukan | Kritis | ✅ Selesai (07-08) | 2026-07-08 | 2026-07-10 | `src/lib/oms-auth.ts`, `src/proxy.ts` |
| **T-1** | Secret HMAC punya fallback hardcoded + token cancel tanpa expiry | Tinggi | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/lib/order-token.ts:13`, `src/lib/oms-auth.ts:21` |
| **T-2** | Rate limit login lemah (in-memory + percaya `X-Forwarded-For`) | Tinggi | 🟡 Sebagian | 2026-07-08 | 2026-07-10 | `src/app/api/oms/login/route.ts` |
| **T-3** | Kredensial seed admin lemah & publik (`admin123`) | Tinggi | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `supabase/migrations/20260708120000_init_admin_users.sql:27` |
| **S-1** | HTTP security headers kosong | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `next.config.ts` |
| **S-2** | IDOR `GET /api/orders/get` + invoice tertebak | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/app/api/orders/get/route.ts` |
| **S-3** | Diskon/promo dihitung client, tak divalidasi server | Sedang | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/lib/promo-cart.ts` |
| **S-4** | `reviews/reply` tak terproteksi + panjang/`imageUrls`/review tersembunyi | Sedang | 🟡 Sebagian | 2026-07-08 | 2026-07-10 | `src/app/api/reviews/{reply,create,list}/route.ts` |
| **S-5** | `order_items` tanpa migration → RLS tak terverifikasi (schema drift) | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `supabase/migrations/` |
| **S-6** | `products/update` validasi longgar + isi gambar tak divalidasi | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/api/products/update/route.ts` |
| **S-7** | Komponen client mengimpor modul secret `oms-auth.ts` | Sedang | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/oms/login/page.tsx:13` |
| **R-1** | Logging/monitoring minim (tak ada audit log aksi admin) | Rendah | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | — |
| **R-2** | Scan CVE dependency (`npm audit`) | Rendah | ✅ Dijalankan (3 moderate) | 2026-07-08 | 2026-07-10 | `next`→`postcss` |
| **R-3** | Tak ada proteksi CSRF di API routes | Rendah | 🔴 Terbuka (naik setelah K-1) | 2026-07-08 | 2026-07-10 | `src/app/api/**` |
| **R-4** | Proxy alamat Mengantar tanpa rate limit | Rendah | 🔴 Terbuka | 2026-07-08 | 2026-07-10 | `src/app/api/mengantar/address/search/route.ts` |
| **R-5** | `/dev/email-preview` aktif di prod + template email `{{ }}` tak di-escape | Rendah | 🔴 Terbuka | 2026-07-10 | 2026-07-10 | `src/app/dev/email-preview/route.ts`, `src/emails/order-confirmation.html` |

> Catatan penomoran: pada 07-08, `admin123` masih tercatat sebagai "Sisa" di K-4. Sejak 07-10
> dipromosikan jadi item mandiri **T-3**. Fallback `OMS_SESSION_SECRET` (dulu "Sisa" K-4)
> digabung ke **T-1** bersama `ORDER_CANCEL_SECRET`.

---

## Urutan prioritas perbaikan (usulan)
1. ~~**K-1 + K-2** — proteksi auth semua endpoint mutasi OMS + `orders/list`.~~ ✅ **Selesai 2026-07-10.**
2. **K-3** — hitung ulang harga/total server-side dari DB. ← **berikutnya**
3. **T-1 + T-3** — fail-fast bila secret prod kosong; rotasi secret; ganti kredensial seed.
4. **S-1, S-2** — security headers; token + invoice tak-tertebak untuk `orders/get`.
5. **T-2, S-3–S-7, R-*** — hardening.

## ✅ Yang sudah benar (jangan diubah tanpa alasan)
Query terparametrisasi (tanpa SQL injection) · stok atomik anti-race (`SELECT … FOR UPDATE`) ·
nol `dangerouslySetInnerHTML` (tanpa XSS) · `service_role` server-only (tak bocor ke bundle client) ·
RLS aktif di tabel yang ada migration-nya · cancel token HMAC timing-safe + validasi status server-side ·
`NEXT_PUBLIC_*` semuanya layak publik · `.env*` sudah di-`.gitignore`.
