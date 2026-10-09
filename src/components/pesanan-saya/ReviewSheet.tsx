"use client";

// src/components/pesanan-saya/ReviewSheet.tsx
// Bottom sheet ulasan untuk SATU pesanan: daftar produknya (yang belum diulas bisa dipilih, yang
// sudah ditandai centang), lalu form rating + komentar per produk. Kirim ke
// /api/reviews/create-by-email — endpoint yang memverifikasi email↔pesanan, produk∈pesanan, dedup,
// dan jendela 14 hari di SERVER; sheet ini hanya menampilkan apa yang server putuskan.
//
// Ulasan disimpan PER PRODUK per pesanan (reviews.order_invoice + product_id), jadi pesanan berisi
// dua produk butuh dua ulasan. Setelah satu produk terkirim, daftar kembali tampil dengan produk itu
// sudah tercentang — pembeli tak perlu mencari pesanannya lagi untuk produk berikutnya.
//
// Form di bawah dipindah utuh dari halaman /review saat halaman Pesanan Saya dilebur (2026-10-09).

import { useState } from "react";
import Image from "next/image";
import { CheckCircle2, ChevronRight, Star, X } from "lucide-react";
import BottomSheet from "@/components/checkout/BottomSheet";
import { fmtInvoice } from "@/components/pesanan-saya/OrderCard";
import { normalizeEmail } from "@/lib/email";
import { REVIEW_COMMENT_MAX } from "@/lib/review-validation";
import type { PublicOrderItem, PublicTrackOrder } from "@/types/public-order";

const PLACEHOLDER = "/images/product-placeholder.png";

export default function ReviewSheet({
  order,
  email,
  honeypot,
  onClose,
  onReviewed,
}: {
  order: PublicTrackOrder | null; // null = tertutup
  email: string;
  honeypot: string;
  onClose: () => void;
  // Dipanggil setelah satu ulasan tersimpan; induk memperbarui daftar pesanannya.
  onReviewed: (orderId: string, productId: string) => void;
}) {
  return (
    <BottomSheet open={order !== null} onClose={onClose}>
      {/* `key` = nomor pesanan: pesanan lain → komponen baru → kembali ke daftar produk. Form
          produk pesanan lama tak boleh tertinggal terbuka. */}
      {order && (
        <ReviewSheetBody
          key={order.orderId}
          order={order}
          email={email}
          honeypot={honeypot}
          onClose={onClose}
          onReviewed={onReviewed}
        />
      )}
    </BottomSheet>
  );
}

function ReviewSheetBody({
  order,
  email,
  honeypot,
  onClose,
  onReviewed,
}: {
  order: PublicTrackOrder;
  email: string;
  honeypot: string;
  onClose: () => void;
  onReviewed: (orderId: string, productId: string) => void;
}) {
  // Produk yang sedang diulas; null = masih di daftar produk.
  const [active, setActive] = useState<PublicOrderItem | null>(null);
  const pending = new Set(order.review.pendingProductIds);
  const deadline = order.review.deadline
    ? formatBatas(order.review.deadline)
    : null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">
            {active ? "Tulis Ulasan" : "Beri Ulasan"}
          </h2>
          <p className="truncate text-xs text-gray-400">
            Pesanan {fmtInvoice(order.orderId)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="rounded-full p-1 text-gray-500 transition hover:bg-gray-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-4">
        {active ? (
          <ReviewProductForm
            item={active}
            orderId={order.orderId}
            email={email}
            honeypot={honeypot}
            onCancel={() => setActive(null)}
            onDone={() => {
              onReviewed(order.orderId, active.productId);
              setActive(null);
            }}
          />
        ) : (
          <>
            {deadline && (
              <p className="mb-3 rounded-xl bg-brand-surface px-3.5 py-2.5 text-xs text-gray-600">
                Ulasan bisa dikirim sampai <strong>{deadline}</strong>.
              </p>
            )}
            <ul className="space-y-2.5">
              {order.items.map((it) => {
                const bisa = pending.has(it.productId) && order.review.eligible;
                return (
                  <li key={it.productId}>
                    <button
                      type="button"
                      disabled={!bisa}
                      onClick={() => setActive(it)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                        bisa
                          ? "border-gray-200 bg-white hover:border-brand-accent active:scale-[0.99]"
                          : "border-gray-100 bg-gray-50"
                      }`}
                    >
                      <div
                        className={`relative h-14 w-14 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50 ${bisa ? "" : "opacity-60"}`}
                      >
                        <Image
                          src={it.imageUrl || PLACEHOLDER}
                          alt={it.name}
                          fill
                          unoptimized
                          sizes="56px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`line-clamp-2 text-sm font-semibold ${bisa ? "text-gray-900" : "text-gray-500"}`}
                        >
                          {it.name}
                        </p>
                        {!pending.has(it.productId) ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Sudah
                            diulas
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs text-brand-accent-ink">
                            Belum diulas
                          </p>
                        )}
                      </div>
                      {bisa && (
                        <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="h-4" />
          </>
        )}
      </div>
    </>
  );
}

// === Form ulasan satu produk ===
function ReviewProductForm({
  item,
  orderId,
  email,
  honeypot,
  onCancel,
  onDone,
}: {
  item: PublicOrderItem;
  orderId: string;
  email: string;
  honeypot: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError("Beri rating bintang terlebih dahulu.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // `authorName` sengaja tidak dikirim — server mengisinya dari pesanan yang sudah
      // diverifikasinya, supaya ulasan tak bisa dikirim atas nama orang lain.
      const res = await fetch("/api/reviews/create-by-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizeEmail(email),
          website: honeypot,
          orderInvoice: orderId,
          productId: item.productId,
          rating,
          comment: comment.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Gagal mengirim ulasan. Coba lagi.");
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError("Terjadi kesalahan jaringan. Coba lagi.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Produk yang diulas */}
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <div className="relative h-14 w-14 flex-none overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
          <Image
            src={item.imageUrl || PLACEHOLDER}
            alt={item.name}
            fill
            unoptimized
            sizes="56px"
            className="object-cover"
          />
        </div>
        <p className="line-clamp-2 text-sm font-semibold text-gray-900">
          {item.name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Rating
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setRating(n);
                  setError("");
                }}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                aria-label={`${n} bintang`}
                className="p-0.5"
              >
                <Star
                  className={`h-8 w-8 transition ${n <= (hover || rating) ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
                />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="comment"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Komentar
          </label>
          <textarea
            id="comment"
            rows={4}
            /* Batas yang sama ditegakkan ulang di server (lib/review-validation); di sini hanya
               memberi tahu pengguna sebelum ia mengetik terlalu jauh. */
            maxLength={REVIEW_COMMENT_MAX}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Bagikan pengalaman Anda dengan produk ini…"
            className="w-full resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {comment.length}/{REVIEW_COMMENT_MAX}
          </p>
        </div>

        <p className="text-xs text-gray-400">
          Ulasan ditampilkan memakai nama pemesan pada pesanan ini.
        </p>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-3 pb-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]"
          >
            Kembali
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-brand-primary py-3 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:opacity-50"
          >
            {submitting ? "Mengirim…" : "Kirim Ulasan"}
          </button>
        </div>
      </form>
    </div>
  );
}

// "15 September 2026" dalam zona WIB — batas jendela ditentukan server dalam WIB juga.
function formatBatas(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ms));
}
