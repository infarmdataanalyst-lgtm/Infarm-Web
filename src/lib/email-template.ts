// src/lib/email-template.ts
// SATU PINTU pengisian placeholder {{key}} pada template email HTML.
// Fungsi murni — tanpa filesystem, tanpa env, tanpa fetch — supaya bisa dipakai preview developer
// MAUPUN pengirim email produksi nanti.
//
// ── Kenapa ini modul tersendiri, bukan ditambal di route preview ──
// Substitusinya dulu tinggal di src/app/dev/email-preview/route.ts sebagai split/join tanpa escape
// (SEC-027). Selama data yang diisikan hanya contoh hardcoded, itu tak berbahaya. Ia menjadi celah
// HTML-injection nyata pada hari nama & alamat pelanggan disambungkan ke template untuk email
// sungguhan. Kalau logikanya dibiarkan di route preview, pengirim produksi hampir pasti menyalin
// ulang polanya berikut bug-nya — jadi jalannya dipersempit ke satu fungsi sejak sekarang.

// Karakter yang bisa keluar dari konteks teks HTML maupun dari nilai atribut ber-kutip.
// & harus lebih dulu, kalau tidak escape-nya sendiri ikut ter-escape (&amp;lt;).
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// Mengubah teks apa adanya menjadi aman disisipkan ke badan HTML maupun ke dalam atribut ber-kutip.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

// Mengisi tiap {{key}} pada template dengan nilai dari `values`.
//
// SEMUA nilai di-escape, KECUALI key yang disebut di `rawKeys`. Daftar putih itu ada karena
// sebagian placeholder memang berisi markup yang kita susun sendiri — `item_list` adalah deretan
// <tr> baris produk. Escape membabi-buta akan menampilkannya sebagai teks mentah di email.
//
// Konsekuensi yang disengaja: nilai untuk key di `rawKeys` menjadi tanggung jawab pemanggil, dan
// pemanggil WAJIB menyusunnya dari potongan yang sudah di-escape satu per satu — jangan pernah
// merangkainya langsung dari input pelanggan.
//
// Placeholder yang tak punya nilai sengaja DIBIARKAN utuh, tidak diganti string kosong: sisa
// {{nama_key}} yang terlihat di preview langsung memberi tahu ada field yang belum diisi backend,
// sedangkan string kosong menyamarkannya.
export function renderEmailTemplate(
  template: string,
  values: Record<string, string>,
  rawKeys: readonly string[] = [],
): string {
  const raw = new Set(rawKeys)
  let html = template
  for (const [key, value] of Object.entries(values)) {
    const replacement = raw.has(key) ? value : escapeHtml(value)
    // split/join = ganti SEMUA kemunculan, dan tak perlu meng-escape key untuk regex.
    html = html.split(`{{${key}}}`).join(replacement)
  }
  return html
}
