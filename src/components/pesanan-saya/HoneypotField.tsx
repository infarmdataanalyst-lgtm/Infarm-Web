// src/components/pesanan-saya/HoneypotField.tsx
// Field jebakan bot: tersembunyi dari manusia (di luar layar, aria-hidden, tabIndex -1), tapi bot
// yang mengisi semua input akan mengisinya. Server membalas kosong senyap bila terisi.
// Dipakai form email dan form konfirmasi pembatalan di Pesanan Saya.

export default function HoneypotField({
  id = 'website',
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
      <label htmlFor={id}>Website (jangan diisi)</label>
      <input
        id={id}
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
