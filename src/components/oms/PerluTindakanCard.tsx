// src/components/oms/PerluTindakanCard.tsx
// Kotak "Perlu tindakan" di atas dashboard OMS. Server Component — membaca langsung dari DB.
//
// Hanya dirender bila ada yang perlu ditindak. Layar yang bersih adalah kabar baik yang harus bisa
// dipercaya; kotak kosong bertuliskan "tidak ada masalah" hanya melatih mata untuk melewatinya,
// dan begitu kotaknya berisi, ia ikut terlewati.
//
// Tiap baris menautkan ke daftar yang SUDAH tersaring ke pesanan bermasalah itu saja, bukan ke
// daftar umum: admin harus bisa sampai ke pesanannya dalam satu klik, tanpa mencari.

import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { readOrderIssues, summarizeOrderIssues } from '@/lib/mock-db/order-issues'
import { ORDER_ISSUE_META, ORDER_ISSUE_ORDER } from '@/lib/order-issues'

export default async function PerluTindakanCard() {
  const summary = summarizeOrderIssues(await readOrderIssues())
  if (summary.total === 0) return null

  const baris = ORDER_ISSUE_ORDER.filter((k) => (summary.byKind[k] ?? 0) > 0)

  return (
    <section
      aria-labelledby="perlu-tindakan-heading"
      className="mt-6 overflow-hidden rounded-xl border border-orange-200 bg-orange-50"
    >
      <div className="flex items-center gap-2 border-b border-orange-200 px-4 py-3">
        <AlertTriangle className="h-5 w-5 flex-none text-orange-600" aria-hidden />
        <h3 id="perlu-tindakan-heading" className="text-sm font-bold text-orange-900">
          Perlu tindakan · {summary.total} pesanan
        </h3>
      </div>
      <ul className="divide-y divide-orange-200">
        {baris.map((kind) => {
          const meta = ORDER_ISSUE_META[kind]
          const n = summary.byKind[kind] ?? 0
          return (
            <li key={kind}>
              <Link
                href={meta.href}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-orange-100"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-orange-900">
                    {meta.labelJamak(n)}
                  </span>
                  <span className="block text-xs text-orange-800/80">{meta.tindakan}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-orange-500" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
