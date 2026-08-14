# Design System: Warna Brand & Tipografi

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)

## Brand Colors & Design System

Semua halaman wajib menggunakan palet warna berikut. Jangan menggunakan warna di luar palet ini tanpa konfirmasi.

### Palet Warna Utama

| Nama | HEX | Kegunaan |
|------|-----|----------|
| `green-primary` | `#00843b` | Background section, tombol utama, navbar, footer, **harga jual** |
| `green-light` | `#96D296` | Background card, badge, hover state |
| `green-surface` | `#F5FFEF` | Background halaman (putih kehijauan), input background |
| `white` | `#FFFFFF` | Teks di atas background hijau, card background |
| `text-dark` | `#1A1A1A` | Teks utama di atas background putih/terang |
| `text-muted` | `#6B7280` | Teks sekunder, harga asli (coret), placeholder |
| `red-promo` | `#EF4444` | Badge promo & badge persentase diskon, notifikasi error |

### Aturan Penggunaan Warna

- Background halaman default: `#F5FFEF` (bukan pure white `#FFFFFF`)
- Tombol primary: background `#00843b`, teks `#FFFFFF`
- Tombol hover: background sedikit lebih gelap dari `#00843b` (gunakan `brightness-90`)
- Card produk: background `#FFFFFF` dengan border atau shadow tipis
- Section banner (value proposition, footer): background `#00843b`, teks `#FFFFFF`
- **Harga jual SELALU `text-brand-primary`** (hijau), bukan merah — konsisten di kartu produk,
  detail produk (harga utama/varian/combo), keranjang, dan ringkasan checkout. Merah hanya untuk
  **badge persentase diskon** (`-25%`), teks "Stok habis", pesan error, dan ikon hapus item.
  Harga asli yang dicoret tetap `text-zinc-400`
- Card fitur di dalam section hijau: background `#96D296`
- **Jangan** menggunakan warna biru, ungu, atau warna brand lain tanpa konfirmasi
- **Pengecualian fungsional** (sudah disepakati): aksi destruktif memakai `rose` (mis. tombol
  "Batalkan Pesanan"), tombol sekunder netral `slate-100`, banner peringatan `orange`, dan
  badge status order (amber/emerald/rose). Tetap hindari biru/ungu.

### Token Brand (sudah dikonfigurasi)

Token brand sudah didefinisikan di `tailwind.config.ts` dan di-load lewat directive
`@config` di `src/app/globals.css` (Tailwind v4):

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      brand: {
        primary: '#00843b',   // hijau utama
        light: '#96D296',     // hijau muda / card
        surface: '#F5FFEF',   // background halaman
        soil: '#6B4E3D',      // cokelat tanah — eyebrow/aksen hangat
        cream: '#EDE3D0',     // krem biji — background lembut alternatif
        dark: '#3B4A2E',      // hijau zaitun gelap
        header: '#00843b',    // background header storefront
      }
    }
  }
}
```

Gunakan class `bg-brand-primary`, `text-brand-primary`, `bg-brand-light`, `bg-brand-surface` di seluruh project.

> **Kalau hex brand diubah**, perbarui tabel palet + blok di atas sekaligus. Satu tempat yang
> TIDAK ikut token: `src/emails/order-confirmation.html` (inline CSS, `#46b33c`) — klien email tak
> mengenal variabel CSS, jadi hex di situ harus diganti manual.

### Tipografi (sudah terpasang)

Dua font, dibagi menurut peran. Terpasang lewat `next/font/google` di `src/app/layout.tsx`.

| Peran | Font | Cara pakai |
|---|---|---|
| Judul & CTA utama (identitas merek) | **Montserrat** (variable, `display: swap`) | token `--font-heading` → utility `font-heading` |
| Teks isi (paragraf, label, tabel) | **Geist Sans** | `--font-sans`, dipakai `body` |
| Angka teknis (SKU, resi, invoice) | **Geist Mono** | utility `font-mono` |

- **`h1`–`h4` otomatis** memakai font merek lewat aturan `@layer base` di `globals.css` — jangan
  tambahkan `font-heading` satu per satu di komponen. **JANGAN pakai `font-sans` pada heading**:
  utility class menang atas aturan base, jadi heading itu akan luput dari font merek (bug ini pernah
  terjadi di headline `HeroSection`).
- **Tombol TIDAK diikutkan** di aturan base. Hanya CTA utama yang diberi `font-heading` eksplisit
  (`StickyBuyBar`, `CartCheckoutBar`, `CheckoutBottomBar`, `MiniCart`, CTA hero). Tombol kecil
  (stepper qty, tutup modal, aksi tabel OMS) sengaja tetap netral & padat.
- Wordmark teks "infarm" (footer, `LegalPageShell`) memakai `font-heading`.
- `body` mengikuti `var(--font-sans)`; Arial hanya fallback. **Jangan hardcode `font-family` di
  `body`** — dulu `body { font-family: Arial }` menimpa font next/font sehingga unduhannya sia-sia.
- **Ganti font merek** (mis. ke font berlisensi seperti Mont dari Fontfabric) cukup di dua tempat:
  deklarasi font di `layout.tsx` + nilai `--font-heading` di `globals.css`. Komponen tak perlu
  disentuh. Font komersial WAJIB dari lisensi *webfont* yang dibeli, self-host via `next/font/local`
  di `src/fonts/` — jangan pakai file dari situs unduhan gratis.

