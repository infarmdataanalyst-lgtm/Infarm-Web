// src/lib/server-secret.ts
// SATU PINTU pengambilan secret penandatangan (HMAC) dari environment. SERVER ONLY.
//
// ── Masalah yang diselesaikan berkas ini ──
// Sebelumnya tiap modul menulis sendiri pola `process.env.X ?? 'string-default'`. Fallback itu
// TERTULIS DI SOURCE, jadi begitu satu deployment produksi lupa menyetel env-nya, kunci
// penandatangan langsung menjadi pengetahuan publik: siapa pun yang membaca repo bisa menempa
// cookie sesi admin dan menempa token pembatalan pesanan. Yang lebih berbahaya, kegagalannya
// SENYAP — semuanya tetap berjalan normal, dan tak ada satu pun gejala sampai ada yang
// memanfaatkannya. Menutup temuan SEC-006.
//
// ── Dua perilaku, sesuai lingkungan ──
// PRODUKSI : env kosong → LEMPAR. Lebih baik satu endpoint mati keras dan langsung terlihat
//            daripada seluruh sistem berjalan dengan kunci yang diketahui umum.
// DEV      : env kosong → secret ACAK per proses, plus peringatan sekali. Sengaja acak, bukan
//            konstanta, supaya tidak ada satu pun nilai bawaan yang bisa dipakai orang luar.
//            Konsekuensinya sesi OMS dan tautan pembatalan berhenti berlaku tiap server di-restart
//            — itu memang harga yang wajar di mesin pengembangan.
//
// ── Kenapa MALAS (lazy), bukan konstanta tingkat modul ──
// `const SECRET = ...` dievaluasi saat modul diimpor. Melempar di situ berarti modul yang cuma
// butuh satu fungsi non-rahasia ikut meledak, dan pada modul yang tak sengaja tertarik ke graph
// klien, lemparannya terjadi di tempat yang membingungkan. Fungsi ini hanya dipanggil di dalam
// operasi tanda tangan/verifikasi, jadi mengimpor modulnya tetap bebas efek samping.

// Memakai Web Crypto (globalThis.crypto), BUKAN node:crypto. Alasannya bukan gaya: modul ini
// dipakai oms-auth.ts, yang ikut berjalan di runtime EDGE lewat proxy.ts. `node:crypto` tak
// tersedia di edge dan akan menggagalkan build di sana.

// Secret dev per proses. Map, bukan satu nilai, agar tiap nama env punya kuncinya sendiri —
// kebocoran nilai satu secret tak ikut membocorkan yang lain.
const devSecrets = new Map<string, string>()
const sudahDiperingatkan = new Set<string>()

function acakHex(jumlahByte: number): string {
  const buf = new Uint8Array(jumlahByte)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function devSecretFor(name: string): string {
  const tersimpan = devSecrets.get(name)
  if (tersimpan) return tersimpan

  const baru = acakHex(32)
  devSecrets.set(name, baru)

  if (!sudahDiperingatkan.has(name)) {
    sudahDiperingatkan.add(name)
    console.warn(
      `[server-secret] ${name} belum diset — memakai secret ACAK sementara untuk proses ini. ` +
        `Sesi & token yang ditandatangani sekarang akan hangus saat server restart. ` +
        `Di production, env ini WAJIB diisi (bila kosong, permintaan akan ditolak).`,
    )
  }
  return baru
}

// Mengembalikan secret bernama `name`, atau melempar di produksi bila belum diset.
//
// Panggil di DALAM fungsi yang menandatangani/memverifikasi, bukan di tingkat modul.
export function requireServerSecret(name: string): string {
  const dariEnv = process.env[name]?.trim()
  if (dariEnv) return dariEnv

  if (process.env.NODE_ENV === 'production') {
    // Pesan sengaja menyebut nama env-nya: yang membaca log ini adalah operator yang perlu tahu
    // persis apa yang harus diisi, dan namanya sendiri bukan rahasia.
    throw new Error(
      `[server-secret] ${name} belum diset di environment production. ` +
        `Menolak menandatangani dengan nilai bawaan — set env ini lalu deploy ulang.`,
    )
  }

  return devSecretFor(name)
}
