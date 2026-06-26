// src/app/oms/dashboard/paket-combo/baru/page.tsx
// Halaman Buat Combo Baru OMS. Memakai ComboForm bersama dalam mode 'create'.
// Sidebar disediakan otomatis oleh layout /oms/dashboard.

import ComboForm from '@/components/oms/ComboForm'

export default function CreateComboPage() {
  return <ComboForm mode="create" />
}
