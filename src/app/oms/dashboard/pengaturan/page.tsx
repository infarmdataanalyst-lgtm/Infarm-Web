'use client'

// src/app/oms/dashboard/pengaturan/page.tsx
// Halaman Pengaturan Toko OMS — empat section lewat tab horizontal (pola sama GudangTabs):
//   1. Profil Toko        → store_settings.store_name / store_description
//   2. Threshold Stok     → store_settings.low_stock_threshold (ambang "stok menipis")
//   3. Minimum Belanja    → store_settings.min_order_amount
//   4. Hari Libur         → store_settings.pickup_holidays (gudang tutup, kurir tak dijadwalkan)
//   5. Jam Penjemputan    → store_settings.pickup_schedule (jam jemput & batas pesanan, rutin dan
//                           khusus per tanggal)
//
// AKSES: halaman ini terbuka untuk sesi OMS apa pun perannya (staff perlu melihat aturan yang
// berlaku), tapi TOMBOL SIMPAN hanya untuk peran 'admin'. Penyembunyian tombol BUKAN penjagaan —
// setiap endpoint tulis memanggil requireAdminRole() sendiri dan membalas 403 untuk 'staff'.
//
// Operasi data via API Route (bukan server action) sesuai aturan CLAUDE.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  Clock,
  Info,
  Lock,
  Store,
  Trash2,
  TriangleAlert,
  Wallet,
  Warehouse,
} from 'lucide-react'
import OmsHeader from '@/components/oms/OmsHeader'
import { formatRupiah } from '@/lib/format'
import {
  DEFAULT_PICKUP_SCHEDULE,
  MAX_PICKUP_HOLIDAYS,
  MAX_PICKUP_OVERRIDES,
  MENGANTAR_PICKUP_HOURS,
  PICKUP_HOLIDAY_LABEL_MAX,
  SPX_EARLIEST_PICKUP_HOUR,
  cutoffOptionsFor,
  formatPickupHour,
  isPickupDay,
  type PickupHoliday,
  type PickupHours,
  type PickupOverride,
  type PickupSchedule,
} from '@/lib/pickup-schedule'

type TabKey = 'profil' | 'stok' | 'minimum' | 'libur' | 'jam'

const TABS: { key: TabKey; label: string; icon: typeof Store }[] = [
  { key: 'profil', label: 'Profil Toko', icon: Store },
  { key: 'stok', label: 'Threshold Stok', icon: TriangleAlert },
  { key: 'minimum', label: 'Minimum Belanja', icon: Wallet },
  { key: 'libur', label: 'Hari Libur', icon: CalendarOff },
  { key: 'jam', label: 'Jam Penjemputan', icon: Clock },
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
        {tab === 'libur' && <HariLiburSection canEdit={canEdit} onSaved={setToast} />}
        {tab === 'jam' && <JamPenjemputanSection canEdit={canEdit} onSaved={setToast} />}
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
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
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
            className="w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
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
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
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
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
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

// === Section 4: Hari Libur penjemputan ===
//
// Minggu selalu libur dan tidak perlu didaftarkan. Yang diatur di sini adalah hari gudang tutup di
// luar itu: Idul Fitri, cuti bersama, tutup dadakan. Aturannya di lib/pickup-schedule.ts; yang
// membaca daftar ini cron slot pickup (06.00 WIB) dan booking kurir setelah pembayaran masuk.
//
// ── Simpan otomatis per baris (sejak 2026-10-12) ──
// Dulu Tambah/Hapus hanya mengubah layar dan baru tersimpan setelah tombol "Simpan Perubahan".
// Itu menipu: pada uji 12 Okt admin menghapus dua libur uji, daftar di layar kosong, tapi database
// masih menyimpan keduanya — pesanan berikutnya tetap dijadwalkan melompati tanggal itu. Kini
// setiap Tambah/Hapus langsung mengirim daftar baru ke server, dan layar baru berubah SETELAH
// server menyimpannya. Jadi yang terlihat selalu sama dengan yang berlaku.
//
// Yang dikirim tetap SELURUH daftar (kontrak PATCH tidak berubah), dihitung dari salinan terakhir
// yang tersimpan, bukan dari layar. Kontrol dikunci selama satu penyimpanan berjalan, sehingga dua
// klik cepat tak bisa saling menimpa. Tanggal lampau dibuang server dan dilaporkan di `dropped`.
function HariLiburSection({
  canEdit,
  onSaved,
}: {
  canEdit: boolean
  onSaved: (msg: string) => void
}) {
  // Daftar yang SUDAH tersimpan di server — satu-satunya sumber yang ditampilkan.
  const [holidays, setHolidays] = useState<PickupHoliday[]>([])
  const [date, setDate] = useState('')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Tanggal WIB "hari ini" menurut SERVER (ikut respons GET) — bukan Date.now() di render, yang
  // dilarang aturan kemurnian komponen dan bisa berbeda zona waktu dengan laptop admin.
  const [today, setToday] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/settings/pickup-holidays', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { holidays?: PickupHoliday[]; today?: string }) => {
        if (!active) return
        if (Array.isArray(data.holidays)) setHolidays(data.holidays)
        if (typeof data.today === 'string') setToday(data.today)
      })
      .catch(() => {
        if (active) setError('Gagal memuat daftar libur.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const tanggalPanjang = (d: string) =>
    new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(`${d}T00:00:00+07:00`))

  // Mengirim daftar baru ke server. true bila tersimpan; layar hanya berubah bila berhasil, jadi
  // kegagalan tak pernah meninggalkan tampilan yang berbeda dari yang berlaku.
  async function simpan(next: PickupHoliday[], pesanSukses: string): Promise<boolean> {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/pickup-holidays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holidays: next }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        holidays?: PickupHoliday[]
        dropped?: string[]
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan daftar libur. Daftar tidak berubah.')
        return false
      }
      setHolidays(Array.isArray(data.holidays) ? data.holidays : next)
      const dibuang = data.dropped?.length ?? 0
      onSaved(dibuang > 0 ? `${pesanSukses} ${dibuang} tanggal yang sudah lewat dibuang.` : pesanSukses)
      return true
    } catch {
      setError('Gagal menyimpan — periksa koneksi lalu coba lagi. Daftar tidak berubah.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function tambah() {
    setError('')
    if (!date) {
      setError('Pilih tanggalnya dulu.')
      return
    }
    if (today && date < today) {
      setError('Tanggal sudah lewat — libur harus didaftarkan sebelum hari H.')
      return
    }
    if (holidays.some((h) => h.date === date)) {
      setError('Tanggal itu sudah ada di daftar.')
      return
    }
    if (holidays.length >= MAX_PICKUP_HOLIDAYS) {
      setError(`Maksimal ${MAX_PICKUP_HOLIDAYS} tanggal.`)
      return
    }
    const clean = label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX)
    const next = [...holidays, clean ? { date, label: clean } : { date }].sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    // Form baru dikosongkan setelah tersimpan — bila gagal, admin tak perlu mengetik ulang.
    if (await simpan(next, `Libur ${tanggalPanjang(date)} tersimpan.`)) {
      setDate('')
      setLabel('')
    }
  }

  function hapus(target: string) {
    void simpan(
      holidays.filter((h) => h.date !== target),
      `Libur ${tanggalPanjang(target)} dihapus.`,
    )
  }

  return (
    <SettingCard
      title="Hari Libur Penjemputan"
      description="Hari gudang tutup di luar hari Minggu. Pada tanggal ini kurir tidak dijadwalkan menjemput; pesanan yang masuk otomatis ikut penjemputan hari kerja berikutnya."
    >
      {/* Daftar tanggal */}
      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-gray-500">Memuat…</p>
        ) : holidays.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
            Belum ada hari libur terdaftar. Minggu selalu libur tanpa perlu didaftarkan.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {holidays.map((h) => (
              <li key={h.date} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <CalendarOff className="h-4 w-4 flex-none text-gray-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{tanggalPanjang(h.date)}</p>
                  {h.label && <p className="truncate text-xs text-gray-500">{h.label}</p>}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => hapus(h.date)}
                    disabled={saving}
                    aria-label={`Hapus libur ${h.date}`}
                    className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form tambah */}
      {canEdit && (
        <div className="mt-4 grid gap-2 sm:grid-cols-[160px_1fr_auto]">
          <input
            type="date"
            value={date}
            min={today || undefined}
            disabled={loading || saving}
            onChange={(e) => {
              setDate(e.target.value)
              setError('')
            }}
            aria-label="Tanggal libur"
            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <input
            type="text"
            value={label}
            maxLength={PICKUP_HOLIDAY_LABEL_MAX}
            disabled={loading || saving}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving) {
                e.preventDefault()
                void tambah()
              }
            }}
            placeholder="Keterangan (opsional), mis. Idul Fitri"
            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <button
            type="button"
            onClick={() => void tambah()}
            disabled={loading || saving}
            className="rounded-xl border border-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary transition hover:bg-brand-primary/5 disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : 'Tambah'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}

      <div className="mt-4 flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-relaxed text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>
            Daftarkan <strong>sebelum hari H</strong>. Pesanan yang masuk pada tanggal libur
            otomatis mendapat jadwal jemput hari kerja pertama sesudahnya; pesanan sehari sebelum
            libur yang masuk sebelum batas pesanan hari itu (tab Jam Penjemputan) tetap dijemput
            hari itu.
          </p>
          <p>
            Setiap Tambah dan Hapus <strong>langsung tersimpan</strong> dan berlaku pada pesanan
            berikutnya. Booking yang <em>sudah terkirim</em> ke Mengantar sebelum libur didaftarkan
            tidak ditarik kembali — periksa kartu jadwal di halaman Pesanan.
          </p>
        </div>
      </div>
    </SettingCard>
  )
}

// === Section 5: Jam Penjemputan ===
//
// Jam kurir datang (jam jemput) dan batas pesanan yang masih ikut penjemputan hari itu (cutoff).
// Dua lapis: jam RUTIN untuk setiap hari pickup, dan jam KHUSUS untuk tanggal tertentu (kurir datang
// lebih awal / lebih sore). Aturan & validasinya di lib/pickup-schedule.ts; server memvalidasi ulang.
//
// Pola simpan mengikuti tab Hari Libur: setiap perubahan mengirim SELURUH jadwal, dan layar baru
// berubah setelah server menyimpannya. Jam rutin memakai tombol Simpan (dua pilihan yang diubah
// bersamaan); jam khusus tersimpan langsung saat Tambah/Hapus.
//
// Bila jam jemput sebuah tanggal yang slotnya sudah dibuat ikut berubah, server membuang slot lama
// supaya booking berikutnya memakai jam baru, dan melaporkan berapa paket yang sudah terlanjur
// dibooking pada jam lama (`bookedOnOldTime`) — paket itu harus diatur manual di Mengantar.
function JamPenjemputanSection({
  canEdit,
  onSaved,
}: {
  canEdit: boolean
  onSaved: (msg: string) => void
}) {
  // Jadwal yang SUDAH tersimpan di server.
  const [schedule, setSchedule] = useState<PickupSchedule>(DEFAULT_PICKUP_SCHEDULE)
  // Isian form jam rutin (belum tentu tersimpan).
  const [rutin, setRutin] = useState<PickupHours>(DEFAULT_PICKUP_SCHEDULE.default)
  const [holidays, setHolidays] = useState<string[]>([])
  const [today, setToday] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Peringatan yang harus tetap terlihat (bukan toast 3 detik): paket terlanjur pada jam lama.
  const [notice, setNotice] = useState('')

  // Form jam khusus
  const [date, setDate] = useState('')
  const [khusus, setKhusus] = useState<PickupHours>(DEFAULT_PICKUP_SCHEDULE.default)
  const [label, setLabel] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/settings/pickup-schedule', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { schedule?: PickupSchedule; today?: string; holidays?: string[] }) => {
        if (!active) return
        if (data.schedule) {
          setSchedule(data.schedule)
          setRutin(data.schedule.default)
          setKhusus(data.schedule.default)
        }
        if (typeof data.today === 'string') setToday(data.today)
        if (Array.isArray(data.holidays)) setHolidays(data.holidays)
      })
      .catch(() => {
        if (active) setError('Gagal memuat jam penjemputan.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const tanggalPanjang = (d: string) =>
    new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(`${d}T00:00:00+07:00`))

  // Ganti jam jemput dan jaga cutoff tetap sah (≤ jam jemput − 2). Cutoff yang tak lagi sah
  // digeser ke pilihan terakhir yang sah, bukan dibiarkan tak terlihat di <select>.
  const gantiJemput = (h: PickupHours, pickupHour: number): PickupHours => {
    const opsi = cutoffOptionsFor(pickupHour)
    return {
      pickupHour,
      cutoffHour: opsi.includes(h.cutoffHour) ? h.cutoffHour : opsi[opsi.length - 1],
    }
  }

  async function simpan(next: PickupSchedule, pesanSukses: string): Promise<boolean> {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/settings/pickup-schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: next }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        schedule?: PickupSchedule
        dropped?: string[]
        resetDates?: string[]
        bookedOnOldTime?: number | null
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Gagal menyimpan jam penjemputan. Jadwal tidak berubah.')
        return false
      }
      const tersimpan = data.schedule ?? next
      setSchedule(tersimpan)
      setRutin(tersimpan.default)
      const dibuang = data.dropped?.length ?? 0
      onSaved(dibuang > 0 ? `${pesanSukses} ${dibuang} jam khusus yang sudah lewat dibuang.` : pesanSukses)

      const terdampak = data.resetDates ?? []
      const paketLama = data.bookedOnOldTime
      if (terdampak.length > 0 && paketLama !== 0) {
        setNotice(
          `${paketLama === null || paketLama === undefined ? 'Sebagian' : paketLama} paket sudah dibooking dengan jam lama untuk ${terdampak
            .map((d) => tanggalPanjang(d))
            .join(', ')}. Paket itu tidak ikut pindah — API Mengantar tidak menyediakan penjadwalan ulang. Atur lewat dashboard atau CS Mengantar; pesanan berikutnya otomatis memakai jam baru.`,
        )
      }
      return true
    } catch {
      setError('Gagal menyimpan — periksa koneksi lalu coba lagi. Jadwal tidak berubah.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const rutinBerubah =
    rutin.pickupHour !== schedule.default.pickupHour || rutin.cutoffHour !== schedule.default.cutoffHour

  function simpanRutin() {
    void simpan(
      { ...schedule, default: rutin },
      `Jam rutin tersimpan: jemput ${formatPickupHour(rutin.pickupHour)}, batas pesanan ${formatPickupHour(rutin.cutoffHour)}.`,
    )
  }

  async function tambahKhusus() {
    setError('')
    if (!date) {
      setError('Pilih tanggalnya dulu.')
      return
    }
    if (today && date < today) {
      setError('Tanggal sudah lewat.')
      return
    }
    if (!isPickupDay(date)) {
      setError('Hari Minggu tidak ada penjemputan — pilih tanggal lain.')
      return
    }
    if (holidays.includes(date)) {
      setError('Tanggal itu terdaftar sebagai hari libur — hapus dulu dari tab Hari Libur bila kurir tetap datang.')
      return
    }
    if (schedule.overrides.some((o) => o.date === date)) {
      setError('Tanggal itu sudah punya jam khusus. Hapus dulu untuk mengubahnya.')
      return
    }
    if (schedule.overrides.length >= MAX_PICKUP_OVERRIDES) {
      setError(`Maksimal ${MAX_PICKUP_OVERRIDES} jam khusus.`)
      return
    }
    const clean = label.trim().slice(0, PICKUP_HOLIDAY_LABEL_MAX)
    const baru: PickupOverride = clean ? { date, ...khusus, label: clean } : { date, ...khusus }
    const next: PickupSchedule = {
      ...schedule,
      overrides: [...schedule.overrides, baru].sort((a, b) => a.date.localeCompare(b.date)),
    }
    const ok = await simpan(
      next,
      `Jam khusus ${tanggalPanjang(date)} tersimpan: jemput ${formatPickupHour(khusus.pickupHour)}.`,
    )
    if (ok) {
      setDate('')
      setLabel('')
    }
  }

  function hapusKhusus(target: string) {
    void simpan(
      { ...schedule, overrides: schedule.overrides.filter((o) => o.date !== target) },
      `Jam khusus ${tanggalPanjang(target)} dihapus — kembali ke jam rutin.`,
    )
  }

  const selectCls =
    'rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500'

  // Dua <select> jam jemput + batas pesanan, dipakai form rutin & form jam khusus.
  const pilihJam = (
    nilai: PickupHours,
    ubah: (h: PickupHours) => void,
    idPrefix: string,
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm" htmlFor={`${idPrefix}-jemput`}>
        <span className="font-medium text-gray-700">Jam kurir menjemput</span>
        <select
          id={`${idPrefix}-jemput`}
          value={nilai.pickupHour}
          disabled={loading || saving || !canEdit}
          onChange={(e) => ubah(gantiJemput(nilai, Number(e.target.value)))}
          className={`mt-1 w-full ${selectCls}`}
        >
          {MENGANTAR_PICKUP_HOURS.map((h) => (
            <option key={h} value={h}>
              {formatPickupHour(h)} WIB
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm" htmlFor={`${idPrefix}-cutoff`}>
        <span className="font-medium text-gray-700">Batas pesanan ikut hari itu</span>
        <select
          id={`${idPrefix}-cutoff`}
          value={nilai.cutoffHour}
          disabled={loading || saving || !canEdit}
          onChange={(e) => ubah({ ...nilai, cutoffHour: Number(e.target.value) })}
          className={`mt-1 w-full ${selectCls}`}
        >
          {cutoffOptionsFor(nilai.pickupHour).map((h) => (
            <option key={h} value={h}>
              sebelum {formatPickupHour(h)} WIB
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  const peringatanSpx = (h: PickupHours) =>
    h.pickupHour < SPX_EARLIEST_PICKUP_HOUR ? (
      <p className="mt-2 flex gap-1.5 text-xs text-amber-700">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Shopee Express (SPX) hanya menjemput pukul {formatPickupHour(SPX_EARLIEST_PICKUP_HOUR)}–22.00
        menurut pusat bantuan Mengantar. Booking SPX pada jam ini kemungkinan ditolak; J&amp;T tidak
        terpengaruh.
      </p>
    ) : null

  return (
    <div className="space-y-5">
      {/* Galat & peringatan di atas kedua kartu: penyimpanan jam rutin maupun jam khusus sama-sama
          bisa memunculkannya, dan peringatan paket-terlanjur harus terlihat tanpa menggulir. */}
      {error && (
        <p className="max-w-2xl rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <div className="flex max-w-2xl gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{notice}</p>
        </div>
      )}

      {/* === Jam rutin === */}
      <SettingCard
        title="Jam Penjemputan Rutin"
        description="Berlaku setiap hari penjemputan (Senin–Sabtu, di luar hari libur). Pesanan yang lunas sebelum batas ikut dijemput hari itu; setelah batas ikut penjemputan hari kerja berikutnya."
      >
        <div className="mt-4">{pilihJam(rutin, setRutin, 'rutin')}</div>
        {!loading && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
            Pesanan lunas <strong>sebelum {formatPickupHour(rutin.cutoffHour)}</strong> dijemput hari
            itu sekitar <strong>{formatPickupHour(rutin.pickupHour)} WIB</strong>; pesanan sesudahnya
            ikut penjemputan hari kerja berikutnya.
          </p>
        )}
        {peringatanSpx(rutin)}
        {canEdit && (
          <SaveButton
            saving={saving}
            disabled={loading || saving || !rutinBerubah}
            onClick={simpanRutin}
          />
        )}
      </SettingCard>

      {/* === Jam khusus per tanggal === */}
      <SettingCard
        title="Jam Khusus per Tanggal"
        description="Untuk hari ketika kurir datang lebih awal atau lebih sore dari biasanya. Tanggal tanpa jam khusus memakai jam rutin di atas. Gudang tutup seharian? Pakai tab Hari Libur."
      >
        <div className="mt-4">
          {loading ? (
            <p className="text-sm text-gray-500">Memuat…</p>
          ) : schedule.overrides.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
              Belum ada jam khusus. Semua hari penjemputan memakai jam rutin.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {schedule.overrides.map((o) => {
                const libur = holidays.includes(o.date)
                return (
                  <li key={o.date} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <CalendarClock className="h-4 w-4 flex-none text-gray-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">{tanggalPanjang(o.date)}</p>
                      <p className="text-xs text-gray-600">
                        Jemput {formatPickupHour(o.pickupHour)} · batas pesanan{' '}
                        {formatPickupHour(o.cutoffHour)}
                        {o.label && <span className="text-gray-500"> · {o.label}</span>}
                      </p>
                      {libur && (
                        <p className="mt-0.5 text-xs font-medium text-amber-700">
                          Tidak berlaku — tanggal ini terdaftar sebagai hari libur.
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => hapusKhusus(o.date)}
                        disabled={saving}
                        aria-label={`Hapus jam khusus ${o.date}`}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {canEdit && (
          <div className="mt-4 space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <label className="block text-sm" htmlFor="khusus-tanggal">
                <span className="font-medium text-gray-700">Tanggal</span>
                <input
                  id="khusus-tanggal"
                  type="date"
                  value={date}
                  min={today || undefined}
                  disabled={loading || saving}
                  onChange={(e) => {
                    setDate(e.target.value)
                    setError('')
                  }}
                  className={`mt-1 w-full ${selectCls}`}
                />
              </label>
              <label className="block text-sm" htmlFor="khusus-label">
                <span className="font-medium text-gray-700">Keterangan (opsional)</span>
                <input
                  id="khusus-label"
                  type="text"
                  value={label}
                  maxLength={PICKUP_HOLIDAY_LABEL_MAX}
                  disabled={loading || saving}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="mis. Stok opname, kurir datang pagi"
                  className={`mt-1 w-full ${selectCls} placeholder:text-gray-400`}
                />
              </label>
            </div>
            {pilihJam(khusus, setKhusus, 'khusus')}
            {peringatanSpx(khusus)}
            <button
              type="button"
              onClick={() => void tambahKhusus()}
              disabled={loading || saving}
              className="rounded-xl border border-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary transition hover:bg-brand-primary/5 disabled:opacity-50"
            >
              {saving ? 'Menyimpan…' : 'Tambah Jam Khusus'}
            </button>
          </div>
        )}

        <div className="mt-4 flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-xs leading-relaxed text-orange-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p>
              Jam jemput hanya bisa jam bulat <strong>09.00–18.00</strong> (yang diterima Mengantar),
              dan batas pesanan minimal <strong>2 jam</strong> sebelumnya — Mengantar menolak booking
              yang kurang dari 90 menit sebelum jam jemput.
            </p>
            <p>
              Ubah <strong>sebelum</strong> ada paket yang dibooking pada tanggal itu. Paket yang
              sudah terbooking tetap pada jam lamanya karena API Mengantar tidak menyediakan
              penjadwalan ulang; atur paket itu lewat dashboard atau CS Mengantar.
            </p>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
