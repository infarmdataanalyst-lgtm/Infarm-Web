// src/app/oms/dashboard/paket-combo/[id]/edit/page.tsx
// Halaman Edit Combo OMS. Server Component tipis: ambil combo dari Supabase (server-only)
// lalu serahkan ke ComboForm bersama dalam mode 'edit'. 404 bila combo tidak ditemukan.

import { notFound } from 'next/navigation'
import ComboForm from '@/components/oms/ComboForm'
import { getComboById } from '@/lib/mock-db/combos'

export default async function EditComboPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const combo = await getComboById(id)
  if (!combo) notFound()

  return <ComboForm mode="edit" initialCombo={combo} />
}
