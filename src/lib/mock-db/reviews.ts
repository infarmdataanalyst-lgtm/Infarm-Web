// src/lib/mock-db/reviews.ts
// Akses data ulasan produk (ditulis dari form /review, dibaca storefront & OMS).
//
// ISOLASI: seluruh akses data ulasan lewat fungsi di file ini.
// Di-back oleh Supabase (tabel public.reviews, FK ke products).
//
// SERVER-ONLY: memakai createAdminClient() (service_role). Jangan diimpor dari komponen 'use client'.

import { createAdminClient } from '@/lib/supabase/server'
import type { ProductReview } from '@/types/product'

const PLACEHOLDER_IMAGE = '/images/product-placeholder.png'

// === Pemetaan baris DB ===

type ReviewRow = {
  id: string
  product_id: string
  author_name: string
  rating: number
  comment: string
  category: string | null
  image_urls: string[]
  reply: string | null
  visible: boolean
  created_at: string
}

// Baris reviews + data produk hasil join (untuk tampilan OMS)
type ReviewWithProductRow = ReviewRow & {
  products: { name: string; sku: string; image_url: string } | null
}

// Payload pembuatan ulasan baru dari form publik
export type CreateReviewInput = {
  productId: string
  authorName: string
  rating: number
  comment: string
  category?: string
  imageUrls?: string[]
  orderInvoice?: string // nomor_invoice pesanan asal — untuk cegah ulasan ganda (order+produk)
}

// Dilempar saat produk pada suatu pesanan sudah pernah diulas (pelanggaran unique constraint).
export class DuplicateReviewError extends Error {
  constructor() {
    super('Produk ini sudah pernah kamu ulas untuk pesanan tersebut.')
    this.name = 'DuplicateReviewError'
  }
}

// Bentuk ulasan untuk halaman Manajemen Ulasan OMS (sudah termasuk info produk)
export type OmsReviewData = {
  id: string
  customerName: string
  productName: string
  productSku: string
  productImage: string
  rating: number
  comment: string
  images: string[]
  date: string
  reply?: string
  visible: boolean
}

// === Baca (storefront) ===

// Mengambil ulasan yang tampil (visible) untuk satu produk, terbaru dulu.
export async function getReviewsByProduct(productId: string): Promise<ProductReview[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('product_id', productId)
    .eq('visible', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca ulasan dari Supabase:', error.message)
    return []
  }

  return (data as ReviewRow[]).map((r) => ({
    id: r.id,
    authorName: r.author_name,
    rating: r.rating,
    date: r.created_at,
    comment: r.comment,
    category: r.category ?? 'Umum',
    imageUrls: r.image_urls?.length ? r.image_urls : undefined,
  }))
}

// Menghitung rata-rata rating & jumlah ulasan tampil untuk satu produk.
export async function getProductRatingSummary(
  productId: string,
): Promise<{ rating: number; reviewCount: number }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('product_id', productId)
    .eq('visible', true)

  if (error || !data || data.length === 0) {
    return { rating: 0, reviewCount: 0 }
  }

  const sum = data.reduce((acc, r) => acc + (r.rating as number), 0)
  // Bulatkan rata-rata ke 1 desimal (mis. 4.7)
  return { rating: Math.round((sum / data.length) * 10) / 10, reviewCount: data.length }
}

// === Tulis (form publik) ===

// Menyimpan ulasan baru. Mengembalikan id ulasan yang dibuat.
// Melempar DuplicateReviewError bila (order_invoice, product_id) sudah ada (unique violation).
export async function createReview(input: CreateReviewInput): Promise<string> {
  const supabase = createAdminClient()

  const base = {
    product_id: input.productId,
    author_name: input.authorName,
    rating: input.rating,
    comment: input.comment,
    category: input.category ?? null,
    image_urls: input.imageUrls ?? [],
  }

  let { data, error } = await supabase
    .from('reviews')
    .insert({ ...base, order_invoice: input.orderInvoice ?? null })
    .select('id')
    .single()

  // Fallback aman bila kolom order_invoice belum di-migrate (kode error kolom tak dikenal)
  if (error && (error.code === 'PGRST204' || error.code === '42703')) {
    ;({ data, error } = await supabase.from('reviews').insert(base).select('id').single())
  }

  // Unique violation (order+produk sudah diulas) → duplikat
  if (error?.code === '23505') {
    throw new DuplicateReviewError()
  }
  if (error || !data) {
    throw new Error(`Gagal menyimpan ulasan: ${error?.message ?? 'tidak diketahui'}`)
  }

  return data.id as string
}

// Daftar product_id yang SUDAH diulas untuk sebuah pesanan (dipakai form review agar
// produk yang sudah diulas tidak bisa diulas lagi). Array kosong bila belum ada / error.
export async function getReviewedProductIds(orderInvoice: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reviews')
    .select('product_id')
    .eq('order_invoice', orderInvoice)

  if (error || !data) return []
  return (data as { product_id: string }[]).map((r) => r.product_id)
}

// === Baca & moderasi (OMS) ===

// Mengambil seluruh ulasan beserta info produk (join) untuk dashboard OMS, terbaru dulu.
export async function listReviewsForOms(): Promise<OmsReviewData[]> {
  const supabase = createAdminClient()
  // Sebut FK eksplisit (products!reviews_product_id_fkey) karena ada >1 relasi reviews→products
  // di skema — tanpa ini embed ambigu & query gagal (OMS jadi kosong).
  const { data, error } = await supabase
    .from('reviews')
    .select('*, products!reviews_product_id_fkey(name, sku, image_url)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Gagal membaca ulasan OMS dari Supabase:', error.message)
    return []
  }

  return (data as ReviewWithProductRow[]).map((r) => ({
    id: r.id,
    customerName: r.author_name,
    productName: r.products?.name ?? '(produk dihapus)',
    productSku: r.products?.sku ?? '-',
    productImage: r.products?.image_url || PLACEHOLDER_IMAGE,
    rating: r.rating,
    comment: r.comment,
    images: r.image_urls ?? [],
    date: r.created_at,
    reply: r.reply ?? undefined,
    visible: r.visible,
  }))
}

// Menyimpan/menghapus balasan admin untuk sebuah ulasan. reply kosong = hapus balasan.
export async function setReviewReply(id: string, reply: string | null): Promise<boolean> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('reviews').update({ reply }).eq('id', id)
  if (error) {
    console.error('Gagal menyimpan balasan ulasan:', error.message)
    return false
  }
  return true
}

// Menyetel apakah ulasan tampil di storefront (visible).
export async function setReviewVisibility(id: string, visible: boolean): Promise<boolean> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('reviews').update({ visible }).eq('id', id)
  if (error) {
    console.error('Gagal mengubah visibilitas ulasan:', error.message)
    return false
  }
  return true
}
