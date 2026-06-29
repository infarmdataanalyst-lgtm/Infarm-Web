// src/app/oms/dashboard/promosi/[id]/edit/page.tsx
// Halaman Edit Promo OMS. Server Component tipis: ambil promo dari Supabase (server-only)
// lalu serahkan ke PromotionForm bersama dalam mode 'edit'. 404 bila promo tidak ditemukan.

import { notFound } from 'next/navigation'
import PromotionForm from '@/components/oms/PromotionForm'
import { getPromotionById } from '@/lib/mock-db/promotions'

export default async function EditPromotionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const promotion = await getPromotionById(id)
  if (!promotion) notFound()

  return <PromotionForm mode="edit" initialPromotion={promotion} />
}
