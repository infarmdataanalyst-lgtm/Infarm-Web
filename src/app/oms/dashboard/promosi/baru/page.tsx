// src/app/oms/dashboard/promosi/baru/page.tsx
// Halaman Buat Promo Baru OMS. Memakai PromotionForm bersama dalam mode 'create'.
// Sidebar disediakan otomatis oleh layout /oms/dashboard.

import PromotionForm from '@/components/oms/PromotionForm'

export default function CreatePromotionPage() {
  return <PromotionForm mode="create" />
}
