// src/app/layout.tsx
// Root layout aplikasi infarm — memuat font global, globals.css, dan metadata default situs.

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
