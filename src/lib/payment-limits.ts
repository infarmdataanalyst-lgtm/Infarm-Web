// src/lib/payment-limits.ts
// Batas nominal yang dipaksakan payment gateway. Konstanta murni — TANPA secret, TANPA I/O —
// supaya bisa diimpor dari komponen klien maupun dari server.

// Nominal terkecil yang masih diterima Xendit untuk satu invoice (rupiah).
//
// ── Kenapa ini harus ada sebagai penjaga, bukan sekadar catatan ──
// Urutan checkout: baris `orders` dibuat + stok dipotong LEBIH DULU (RPC atomik), baru invoice
// Xendit dibuat pada permintaan berikutnya. Kalau nominalnya di bawah batas ini, Xendit menolak
// SESUDAH pesanan terlanjur ada — hasilnya pesanan PENDING yang menahan stok dan tak punya cara
// dibayar. Tidak ada yang me-rollback-nya.
//
// Sebelum 2026-09-07 angka ini hanya hidup sebagai SUGGESTED_LINE_TOTAL di validator form produk
// yang tak pernah dijalankan saat checkout, jadi praktis tak ada penjaganya sama sekali. Risikonya
// naik tajam begitu diskon & gratis ongkir dinyalakan — keduanya menurunkan total yang ditagih.
//
// Dipakai sebagai `minTotal` di computeOrderPromos(): diskon dikurangi seperlunya sampai total
// mendarat tepat di angka ini, bukan checkout-nya yang ditolak. Pembeli yang justru mendapat
// diskon besar tidak boleh malah kehilangan kemampuan membayar.
export const XENDIT_MIN_AMOUNT = 10_000
