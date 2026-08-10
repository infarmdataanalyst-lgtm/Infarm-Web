// src/app/layout.tsx
// Root layout aplikasi infarm — memuat font global, globals.css, dan metadata default situs.

import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import GoogleAnalyticsGate from "@/components/analytics/GoogleAnalyticsGate";
import FloatingWhatsApp from "@/components/ui/FloatingWhatsApp";
import "./globals.css";

// Font identitas merek: dipakai untuk judul & tombol utama (class `font-heading`), BUKAN teks isi —
// Montserrat lebih lebar dari sans netral, sehingga paragraf panjang (deskripsi produk, halaman
// legal) jadi terlalu memanjang bila memakainya. Variable font: 100–900 dalam satu file, jadi
// font-bold/font-extrabold tak menambah request.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap", // teks langsung tampil dengan fallback, tak ada jeda kosong
});

// Font teks isi (paragraf, label, tabel) — netral & padat.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Metadata default situs (di-override per route group bila perlu, mis. (store)/layout.tsx)
export const metadata: Metadata = {
  title: "infarm.id — Berkebun Jadi Mudah, Pasti Panen",
  description:
    "Belanja benih, pupuk, media tanam, dan peralatan berkebun original di infarm.id.",
};

// Root layout: membungkus seluruh halaman dengan struktur HTML, font, dan tema dasar
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Measurement ID dari env (jangan hardcode). GA4 hanya dipasang bila ID terisi,
  // supaya placeholder tidak ikut jalan di lokal/dev. Gate membatasi GA hanya di
  // routing e-commerce (buyer), bukan di OMS/admin.
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Tombol WhatsApp mengambang (self-gate: sembunyi di /oms) */}
        <FloatingWhatsApp />
        {gaId && <GoogleAnalyticsGate gaId={gaId} />}
      </body>
    </html>
  );
}
