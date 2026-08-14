'use client'

// src/app/oms/dashboard/pengaturan/page.tsx
// Halaman Pengaturan Toko OMS — tiga section lewat tab horizontal (pola sama GudangTabs):
//   1. Profil Toko        → store_settings.store_name / store_description
//   2. Threshold Stok     → store_settings.low_stock_threshold (ambang "stok menipis")
//   3. Minimum Belanja    → store_settings.min_order_amount
//
// AKSES: halaman ini terbuka untuk sesi OMS apa pun perannya (staff perlu melihat aturan yang
// berlaku), tapi TOMBOL SIMPAN hanya untuk peran 'admin'. Penyembunyian tombol BUKAN penjagaan —
// setiap endpoint tulis memanggil requireAdminRole() sendiri dan membalas 403 untuk 'staff'.
//
// Operasi data via API Route (bukan server action) sesuai aturan CLAUDE.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Info, Lock, Store, TriangleAlert, Wallet, Warehouse } from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'

type TabKey = 'profil' | 'stok' | 'minimum'

const TABS: { key: TabKey; label: string; icon: typeof Store }[] = [
  { key: 'profil', label: 'Profil Toko', icon: Store },
  { key: 'stok', label: 'Threshold Stok', icon: TriangleAlert },
  { key: 'minimum', label: 'Minimum Belanja', icon: Wallet },
]

// Batas yang sama dengan validasi server (lib/mock-db/settings.ts) — dipakai untuk maxLength
// & penghitung karakter. Server tetap memvalidasi ulang; ini hanya membantu admin sebelum submit.
const STORE_NAME_MAX = 100
const STORE_DESCRIPTION_MAX = 500

type WarehouseRow = {
  id: string
  nama: string
  alamat?: string
  mengantarOriginId?: string
  isDefault: boolean
}

export default function PengaturanPage() {
  const [tab, setTab] = useState<TabKey>('profil')
  const [canEdit, setCanEdit] = useState(false)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [toast, setToast] = useState('')

  // Peran admin → menentukan tombol Simpan tampil atau tidak
  useEffect(() => {
    let active = true
    fetch('/api/oms/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { canEdit?: boolean } | null) => {
        if (!active) return
        setCanEdit(Boolean(data?.canEdit))
        setRoleLoaded(true)
      })
      .catch(() => {
        if (active) setRoleLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Auto-sembunyikan toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <>
      <OmsHeader title="Pengaturan" />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        {/* === Tab horizontal === */}
        <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-none items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>

        {/* Peringatan peran — muncul hanya untuk staff, setelah peran diketahui */}
        {roleLoaded && !canEdit && (
          <div className="mb-5 flex max-w-2xl gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Akun Anda berperan <strong>Staf Operasional</strong> — pengaturan bisa dilihat tapi
              tidak bisa diubah. Hubungi admin utama untuk perubahan.
            </p>
          </div>
        )}

        {tab === 'profil' && <ProfilTokoSection canEdit={canEdit} onSaved={setToast} />}
        {tab === 'stok' && <ThresholdStokSection canEdit={canEdit} onSaved={setToast} />}
        {tab === 'minimum' && <MinimumBelanjaSection canEdit={canEdit} onSaved={setToast} />}
      </div>

      {/* Toast sukses */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          {toast}
        </div>
      )}
    </>
  )
}

// === Kerangka kartu bersama ===

function SettingCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">{description}</p>
      {children}
    </div>
  )
}

function SaveButton({
  saving,
  disabled,
  onClick,
}: {
  saving: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-5 rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
    </button>
  )
}

// === Section 1: Profil Toko ===

function ProfilTokoSection({
  canEdit,
  onSaved,
}: {
  canEdit: boolean
  onSaved: (msg: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/settings/store-profile', { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch('/api/warehouses/list', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([profile, wh]: [{ name?: string; description?: string } | null, { warehouses?: WarehouseRow[] } | null]) => {
        if (!active) return
        if (profile) {
          setName(profile.name ?? '')
          setDescription(profile.description ?? '')
        }
        setWarehouses(wh?.warehouses ?? [])
      })
      .catch(() => {
        if (active) setError('Gagal memuat pengaturan.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    if (name.trim().length < 2) {
      setError('Nama toko minimal 2 karakter.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/store-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan pengaturan.')
        return
      }
      onSaved('Profil toko tersimpan.')
    } catch {
      setError('Gagal menyimpan pengaturan. Periksa koneksi lalu coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  // Gudang default = asal pengiriman yang dipakai cek ongkir
  const defaultWarehouse = warehouses.find((w) => w.isDefault)

  return (
    <SettingCard
      title="Profil Toko"
      description="Identitas toko yang dipakai di tampilan internal OMS. Perubahan berlaku seketika."
    >
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="store-name" className="mb-1.5 block text-sm font-medium text-gray-700">
            Nama Toko
          </label>
          <input
            id="store-name"
            type="text"
            value={name}
            maxLength={STORE_NAME_MAX}
            disabled={loading || saving || !canEdit}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            placeholder={loading ? 'Memuat…' : 'infarm'}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor="store-desc" className="mb-1.5 block text-sm font-medium text-gray-700">
            Deskripsi Toko
          </label>
          <textarea
            id="store-desc"
            rows={3}
            value={description}
            maxLength={STORE_DESCRIPTION_MAX}
            disabled={loading || saving || !canEdit}
            onChange={(e) => {
              setDescription(e.target.value)
              setError('')
            }}
            placeholder={loading ? 'Memuat…' : 'Sayuran & kebutuhan berkebun segar dari infarm.'}
            className="w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {description.length}/{STORE_DESCRIPTION_MAX}
          </p>
        </div>

        {/* Alamat gudang — READ-ONLY di sini.
            Sumber kebenarannya tabel `warehouses`, bukan store_settings. Menyalinnya ke sini
            akan membuat dua tempat menyimpan alamat yang sama, dan cepat atau lambat keduanya
            berbeda — kesalahan yang sama seperti env WAREHOUSE_MODE yang sudah dibuang. */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
          <div className="flex items-center gap-2">
            <Warehouse className="h-4 w-4 text-gray-500" aria-hidden />
            <p className="text-sm font-semibold text-gray-800">Alamat Gudang (Asal Pengiriman)</p>
            <Lock className="h-3.5 w-3.5 text-gray-400" aria-hidden />
          </div>

          {loading ? (
            <p className="mt-2 text-sm text-gray-500">Memuat…</p>
          ) : defaultWarehouse ? (
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p className="font-medium text-gray-800">{defaultWarehouse.nama}</p>
              <p>{defaultWarehouse.alamat || 'Alamat belum diisi.'}</p>
              <p className="font-mono text-xs text-gray-500">
                Origin ID Mengantar: {defaultWarehouse.mengantarOriginId || '(kosong)'}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Belum ada gudang default.</p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            Alamat & origin ID dikelola di halaman Gudang supaya hanya ada satu sumber data —
            angka yang sama dipakai cek ongkir dan pemilihan gudang pemenuh pesanan.{' '}
            <Link
              href="/oms/dashboard/gudang"
              className="font-semibold text-brand-primary hover:underline"
            >
              Kelola gudang →
            </Link>
          </p>
        </div>

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      </div>

      {canEdit && (
        <SaveButton saving={saving} disabled={loading || saving} onClick={() => void handleSave()} />
      )}
    </SettingCard>
  )
}

// === Section 2: Threshold Stok Menipis ===

function ThresholdStokSection({
  canEdit,
  onSaved,
}: {
  canEdit: boolean
  onSaved: (msg: string) => void
}) {
  const [value, setValue] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/settings/low-stock-threshold', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { lowStockThreshold?: number }) => {
        if (active && typeof data.lowStockThreshold === 'number') setValue(data.lowStockThreshold)
      })
      .catch(() => {
        if (active) setError('Gagal memuat pengaturan.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    if (value === '' || value < 1) {
      setError('Ambang minimal 1.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/low-stock-threshold', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lowStockThreshold: Number(value) }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        lowStockThreshold?: number
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan pengaturan.')
        return
      }
      if (typeof data.lowStockThreshold === 'number') setValue(data.lowStockThreshold)
      onSaved('Ambang stok menipis tersimpan.')
    } catch {
      setError('Gagal menyimpan pengaturan. Periksa koneksi lalu coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingCard
      title="Ambang Stok Menipis"
      description="Produk dengan stok efektif di bawah angka ini ditandai “Stok Menipis”."
    >
      <div className="mt-4">
        <label htmlFor="low-stock" className="mb-1.5 block text-sm font-medium text-gray-700">
          Ambang Stok Menipis (pcs)
        </label>
        <input
          id="low-stock"
          type="text"
          inputMode="numeric"
          value={value}
          disabled={loading || saving || !canEdit}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '')
            setValue(digits === '' ? '' : Number(digits))
            setError('')
          }}
          placeholder={loading ? 'Memuat…' : '10'}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
        />
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-relaxed text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Berlaku serentak di kartu ringkasan &amp; filter “Stok Menipis” halaman Produk, widget
          “Stok Rendah” di Dashboard, dan notifikasi stok. Stok 0 selalu dihitung{' '}
          <strong>Stok Habis</strong> terlepas dari angka ini, jadi ambang minimal 1.
        </p>
      </div>

      {canEdit && (
        <SaveButton
          saving={saving}
          disabled={loading || saving || value === ''}
          onClick={() => void handleSave()}
        />
      )}
    </SettingCard>
  )
}

// === Section 3: Minimum Total Belanja ===

function MinimumBelanjaSection({
  canEdit,
  onSaved,
}: {
  canEdit: boolean
  onSaved: (msg: string) => void
}) {
  const [amount, setAmount] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/settings/min-order')
      .then((res) => res.json())
      .then((data: { minOrderAmount?: number }) => {
        if (active && typeof data.minOrderAmount === 'number') setAmount(data.minOrderAmount)
      })
      .catch(() => {
        if (active) setError('Gagal memuat pengaturan.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    if (amount === '' || amount < 0) {
      setError('Isi nilai minimum yang valid.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/min-order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minOrderAmount: Number(amount) }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        minOrderAmount?: number
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan pengaturan.')
        return
      }
      if (typeof data.minOrderAmount === 'number') setAmount(data.minOrderAmount)
      onSaved('Pengaturan tersimpan.')
    } catch {
      setError('Gagal menyimpan pengaturan. Periksa koneksi lalu coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingCard
      title="Minimum Total Belanja"
      description="Pembeli tidak bisa melanjutkan ke pembayaran bila subtotal barang (belum termasuk ongkir) masih di bawah nilai ini."
    >
      <div className="mt-4">
        <label htmlFor="min-order" className="mb-1.5 block text-sm font-medium text-gray-700">
          Minimum Total Belanja (Rp)
        </label>
        <input
          id="min-order"
          type="text"
          inputMode="numeric"
          value={amount}
          disabled={loading || saving || !canEdit}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '')
            setAmount(digits === '' ? '' : Number(digits))
            setError('')
          }}
          placeholder={loading ? 'Memuat…' : '15000'}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
        />
        {amount !== '' && (
          <p className="mt-1 text-xs font-medium text-emerald-700">{formatRupiah(Number(amount))}</p>
        )}
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>

      {/* Konteks angka: kenapa jangan terlalu rendah */}
      <div className="mt-4 flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-relaxed text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Disarankan minimal {formatRupiah(15000)}. Payment gateway menolak transaksi di bawah ±
          {formatRupiah(10000)}, dan diskon promo masih bisa menurunkan total tagihan setelah
          subtotal terpenuhi.
        </p>
      </div>

      {canEdit && (
        <SaveButton
          saving={saving}
          disabled={loading || saving || amount === ''}
          onClick={() => void handleSave()}
        />
      )}
    </SettingCard>
  )
}
