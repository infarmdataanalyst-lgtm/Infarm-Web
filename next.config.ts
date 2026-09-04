// next.config.ts
// Konfigurasi Next.js. Saat ini isinya HANYA HTTP security header — lihat catatan di bawah.

import type { NextConfig } from "next";

// === HTTP Security Header (menutup SEC-012) ===
//
// Sebelumnya berkas ini kosong, jadi tidak satu pun header keamanan terkirim. Yang paling konkret
// merugikan: /oms/login dan /oms/dashboard bisa di-iframe situs lain, sehingga admin rawan
// clickjacking lewat overlay transparan di atas form login atau tombol aksi.
//
// Referrer-Policy dapat perhatian khusus di project ini: tautan pembatalan pesanan membawa token
// HMAC DI QUERY STRING (/order-cancellation?id=&token=). Dengan kebijakan default browser, token
// itu ikut terkirim di header Referer ke setiap domain pihak ketiga yang di-load halaman tersebut.
// strict-origin-when-cross-origin memotong path & query saat menyeberang origin, jadi yang terkirim
// tinggal origin-nya saja.
const securityHeaders = [
  // Larang situs lain mem-frame halaman kita sama sekali (anti clickjacking).
  // frame-ancestors di CSP adalah penerusnya, tapi X-Frame-Options masih dipatuhi browser lama.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Jangan biarkan browser menebak-nebak tipe konten (MIME sniffing). Relevan karena foto produk
  // disajikan dari Supabase Storage publik dengan contentType yang berasal dari data-URL.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Jangan bocorkan path & query ke origin lain — lihat catatan token pembatalan di atas.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Matikan API perangkat yang tidak dipakai sama sekali oleh storefront maupun OMS.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },

  // HSTS. Aman dipasang: Vercel sudah HTTPS-only dan header ini diabaikan browser di http://localhost,
  // jadi dev lokal tidak terkunci. preload SENGAJA tidak dipasang — mendaftarkannya ke daftar preload
  // browser sulit dibatalkan dan itu keputusan pemilik domain, bukan efek samping sebuah commit.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },

  // CSP mode REPORT-ONLY dulu, sesuai rekomendasi temuan.
  //
  // Kenapa belum ditegakkan: Next.js menyuntikkan inline <script> untuk data hidrasi, dan Turbopack
  // dev memakai eval. Menegakkan CSP tanpa nonce per-request akan mematikan halaman. Menaikkannya
  // ke Content-Security-Policy yang mengikat menuntut pipeline nonce di proxy.ts — pekerjaan
  // tersendiri, bukan bagian penutupan temuan ini. Sampai itu ada, mode report-only memberi
  // pembatas frame-ancestors yang nyata plus visibilitas pelanggaran, tanpa risiko merusak.
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      // Supabase Storage (foto produk) + data: untuk pratinjau gambar sebelum diunggah
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      // 'unsafe-inline' & 'unsafe-eval': lihat alasan di atas (hidrasi Next + Turbopack dev)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // Berlaku untuk SEMUA path, termasuk /api/* dan aset statis.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
