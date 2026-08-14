# Halaman Storefront

> Dipecah dari `CLAUDE.md` (2026-08-14). Isi dipindahkan APA ADANYA, tanpa pemangkasan.
> Kembali ke ringkasan: [CLAUDE.md](../CLAUDE.md)
>
> Urutan section mengikuti urutan aslinya di CLAUDE.md (bukan urutan penyebutan di rencana)
> supaya pemindahannya bisa diverifikasi baris-per-baris.

## Riwayat "Dilihat Sebelumnya" (Recently Viewed)

- **localStorage** (guest, sisi-klien) key `recently_viewed_products` — `src/lib/recently-viewed.ts`
  (`trackProductView`, `getRecentlyViewedIds`). Array `{ product_id, viewed_at }`, terbaru di depan,
  maks 10, anti-duplikat, semua akses `try/catch` (aman saat disabled/penuh).
- Dicatat saat buka detail produk via `TrackProductView` (komponen null, `'use client'`).
- Ditampilkan di **keranjang** (`CartRecentlyViewed`): resolve id → data produk **terbaru** (OMS+dummy),
  buang produk diarsipkan atau yang sudah ada di keranjang, maks 6; section disembunyikan bila kosong.

## Header & Search Persisten (storefront)

- Header storefront = **`AppBar`** (Server Component, dirender di `(store)/layout.tsx`, fixed, `bg-brand-header`
  hijau `#00843b` + teks/ikon putih, `rounded-b-[2rem]`, `backdrop-blur`). Layout: `[hamburger+logo] — [HeaderSearch] — [cart+profil]`.
- **Halaman mana yang memakai `AppBar`**: HANYA route group `(store)` — beranda, `/products`,
  `/produk/[id]`. Halaman di luar group punya header sendiri: `/keranjang` → `CartHeader`,
  `/checkout` → `CheckoutHeader`, `/pesanan-saya` & layanan pesanan → header masing-masing,
  halaman legal → `LegalPageShell`. Jadi "menyembunyikan elemen header" di halaman-halaman itu
  tidak perlu conditional apa pun — elemennya memang tak pernah dirender.
- **`CheckoutHeader`** sengaja minimal demi fokus pembayaran: tombol kembali + **logo NON-tautan**
  + judul. Tanpa search/keranjang/akun, dan `FloatingWhatsApp` self-gate di `/checkout`.
  **Jangan menambah navigasi keluar baru di header ini**; logo tidak dibungkus `<Link>` agar user
  tak tercampak dari alur pembayaran karena menyenggolnya.
- **Pembagian tugas navigasi header (jangan dicampur lagi)**: `MenuDrawer` = **navigasi katalog**
  (beranda/produk/keranjang + kategori); `ProfileIconLink` = **layanan pesanan** (hub/lacak/
  batalkan/review). Section "Pesanan" DIHAPUS dari drawer agar tak tumpang tindih dengan ikon akun.
- **`MenuDrawer`** (`components/ui/`, client) = tombol hamburger + panel geser dari kiri. Dua section:
  Navigasi (Beranda / Semua Produk / Keranjang) dan Kategori Produk (dari `PRODUCT_CATEGORIES` —
  satu sumber dengan `CategoryGrid` & filter katalog).
  Tutup lewat backdrop, tombol ×, `Escape`, atau klik tautan (`onClick` di `<nav>`, BUKAN efek
  `pathname` — lint `react-hooks/set-state-in-effect` melarangnya). Scroll body dikunci saat terbuka;
  panel `inert` saat tertutup.
  **WAJIB portal ke `document.body`** (`createPortal`): `AppBar` memakai `backdrop-blur-md`, dan
  elemen ber-`backdrop-filter` jadi containing block untuk anak `position: fixed` → tanpa portal
  `inset-y-0` mengacu ke tinggi AppBar (56px), drawer terpotong & backdrop cuma menutupi header.
  Deteksi klien pakai `useSyncExternalStore` (bukan setState di `useEffect`, dilarang lint).
  Konsekuensi: isi drawer tidak ada di HTML awal — tak masalah, tautan kategori/nav juga tersedia
  di `CategoryGrid` beranda & footer. **Tanpa penanda aktif untuk kategori**: membacanya butuh
  `useSearchParams` yang memaksa halaman jadi dinamis, sementara beranda & katalog sengaja ISR.
- **`CartIconLink` + `MiniCart`** (`components/ui/`, client) = ikon keranjang + badge jumlah item.
  **Mobile (<640px)**: `<Link>` ke `/keranjang` (tak berubah). **Desktop (≥640px)**: tombol yang
  membuka **mini cart** `absolute right-0 top-full w-96` — daftar item, subtotal, tombol
  "Lihat Keranjang" & "Checkout"; kosong → ajakan "Mulai Belanja". Tutup via klik-luar
  (`pointerdown`), `Escape`, atau klik aksi.
  - Pemilihan varian pakai **`useMediaQuery`** (`src/hooks/use-media-query.ts`, `useSyncExternalStore`),
    BUKAN kelas `sm:hidden` — `id="cart-anchor"` harus unik & punya ukuran nyata karena dipakai
    animasi fly-to-cart (`StickyBuyBar`); elemen `display:none` memberi rect 0×0 → animasi ngawur.
    Efek sampingnya menguntungkan: di mobile `MiniCart` **tidak pernah di-mount**, jadi kontrol
    jumlah di bawah tak butuh penjagaan breakpoint tambahan — pemisahannya struktural.
  - Detail produk di-resolve `GET /api/products/by-ids` **hanya saat panel dibuka**; foto pakai
    `Image ... unoptimized` (URL Supabase Storage belum di `remotePatterns`), pola sama `CartItemRow`.
  - Tombol Checkout WAJIB `setCheckoutItems(cart)` sebelum `router.push('/checkout')`.
  - **Kontrol jumlah per baris (desktop)** — tata letak `[− n +] [foto 44px] [nama + harga + 🗑]`.
    Panel `w-96` (384px), BUKAN `w-80`: dengan stepper di kiri, 320px hanya menyisakan ±168px
    untuk nama dan nama produk katalog ini panjang. Nama pakai **`line-clamp-2`**; **jangan
    tambahkan `block`** di elemen itu — `line-clamp` butuh `display: -webkit-box` dan `block`
    menimpanya sehingga barisnya memanjang jadi ~156px.
    - **"−" berhenti di `minOrderQty` (disabled), TIDAK menghapus item**; penghapusan lewat ikon
      tong sampah tersendiri. Disamakan dengan `CartItemRow` di `/keranjang` — aturan tombol yang
      sama tak boleh berbeda di dua tempat.
    - **"+" dibatasi `StoredProduct.stock`** (sudah ikut terbawa dari `by-ids`), dengan keterangan
      "Stok tersisa N" supaya alasan tombol mati terbaca. Batas ini **PEMANDU, bukan penegakan**:
      datanya bisa basi ≤30 dtk (endpoint cached) dan untuk produk bervarian angkanya stok
      level-produk. Penegakan sebenarnya di `orders/create` (RPC atomik → `INSUFFICIENT_STOCK`).
      Produk yang tak ter-resolve (mis. dummy non-OMS) `stock` undefined → "+" TIDAK dibatasi.
    - **Tanpa input ketik manual** (beda dari `CartItemRow`): di 384px kolom angka yang bisa
      difokus hanya menambah jalur kesalahan; pengetikan bebas tetap ada di `/keranjang`.
    - **Tanpa spinner/loading state** — perubahan jumlah TIDAK async. Stok & `minOrderQty` sudah
      di memori sejak panel dibuka, jadi validasinya perbandingan angka, nol request per klik.
      Jangan tambahkan indikator loading di sini; tak ada yang ditunggu.
    - **Sinkron ke `/keranjang` GRATIS**: keduanya membaca store `useSyncExternalStore` yang sama
      di atas cookie `infarm_cart`, jadi `updateQuantity()`/`removeFromCart()` langsung terlihat
      di kedua tempat. Tak ada salinan state kedua yang perlu didamaikan.
    - **Animasi sorotan tanpa state React**: elemen angka/harga diberi `key` = nilainya, sehingga
      React me-mount ulang elemen itu saat nilainya berubah dan keyframe `.animate-value-flash`
      (`globals.css`) otomatis diputar dari awal. Pola ini dipilih karena alternatifnya
      setState + timer per baris, yang dilarang lint `react-hooks/set-state-in-effect`.
      Dihormati `prefers-reduced-motion: reduce`.
- **`ProfileIconLink`** (`components/ui/`, client) = ikon akun + badge angka pesanan aktif (cookie
  `infarm_active_orders`, tanpa query DB). Klik/tap ikon → dropdown `absolute right-0 top-full`
  berisi **3 aksi**: Lacak / Batalkan / Beri Review (+ baris kepala "N pesanan aktif"); tutup via
  klik-luar (`pointerdown`), `Escape`, atau klik item. **Satu perilaku untuk semua ukuran layar**
  (mobile TIDAK lagi navigate ke `/pesanan-saya`) supaya pembeli tak kehilangan konteks halaman
  yang sedang dibuka. Item "Pesanan Saya" sengaja dihapus dari dropdown — hub `/pesanan-saya`
  kini TIDAK ditautkan dari header, hanya dari tombol "kembali" di `/track-order`, `/cancel-order`,
  `/review`. Baris menu `py-3 sm:py-2.5` agar
  target sentuh mobile nyaman. Dropdown pakai `absolute`, BUKAN `fixed`, jadi tak kena masalah
  containing block `backdrop-filter` seperti `MenuDrawer`.
  **Tanpa Profil/Logout/Alamat Tersimpan/Pengaturan** — proyek ini guest checkout, tak ada akun
  pelanggan; jangan tambahkan item itu tanpa membangun sistem auth pelanggan dulu.
- **`HeaderSearch`** (`components/ui/`, client) = search autocomplete PERSISTEN (dulu `HeroSearchBar` di hero, sudah dihapus):
  - Desktop (sm+): input inline (`bg-white/15`, pill, ikon search kanan sebagai trigger), lebar `max-w-[320px]` rata kanan.
  - Mobile: ikon kaca pembesar → **overlay full-width** (`fixed inset-0`) menutupi header (tombol ←, input, dropdown).
  - Saran on-type via `GET /api/products/search` (debounce). Logika autocomplete sama dgn versi hero lama.

## Halaman Katalog `/products` — Filter Lengkap

- **`ProductCatalog`** (client) merakit filter + grid; `products/page.tsx` hanya membungkus dengan `<Suspense>`
  (butuh `useSearchParams`). Data = produk OMS non-arsip via `/api/products/list`.
- **Desktop (lg+)**: sidebar kiri sticky (kategori **multi-checkbox** custom [box putih border → hijau+centang putih],
  rentang harga Min–Maks, tombol **Terapkan**) + konten kanan (judul, jumlah, sort). **Mobile**: baris kontrol
  (Filter, Urutkan, chip kategori aktif ×) → **bottom-sheet** (reuse `checkout/BottomSheet`) untuk filter & sort.
- **Sort** = Headless UI `Listbox` (Terbaru/Harga Terendah/Tertinggi), highlight opsi tema hijau. Filter kategori & harga
  **staged** (berlaku saat Terapkan); sort instan. Chip × hapus kategori langsung.
- **Sinkron URL** `?category=a,b` via **`window.history.replaceState`** (BUKAN `router.replace`) — hindari navigasi/
  Suspense fallback yang bikin bottom-sheet nyangkut. Deep-link dari `CategoryGrid` beranda (slug tunggal) tetap jalan.
  - **WAJIB `replaceState(window.history.state, '', href)`** — meneruskan state yang ada. Next menyimpan state
    router di `history.state`; menimpanya dengan `null` merusak navigasi soft berikutnya.
  - **Filter WAJIB ikut berubah saat `?category=` berganti tanpa remount** (mis. klik kategori di `MenuDrawer`
    sementara user sudah di `/products`). `useState` hanya membaca URL sekali → ada penyesuaian state
    **saat render** (pola resmi React) dengan pembanding `syncedCategoryParam`, yang juga diperbarui di
    `syncUrl` agar klik kategori sama setelah filter diubah manual tetap terdeteksi.
- Label jumlah: `"{n} produk"` (+ ` · {Kategori}` bila tepat 1 kategori aktif). `CategoryFilterTabs` (kapsul lama) DIHAPUS.

## Halaman Detail Produk — CTA & Deskripsi

- **Tombol beli responsif per breakpoint** (`StickyBuyBar`, satu instance saja):
  - **Mobile (< lg)**: `fixed inset-x-0 bottom-0 z-40` + latar putih & `border-t` — mengambang di
    dasar layar, seperti sebelumnya.
  - **Desktop (lg+)**: `lg:static lg:border-0 lg:bg-transparent` → mengalir sebagai blok biasa di
    kolom kanan, **di bawah section Deskripsi Produk**, tanpa panel putih (murni dua tombol).
    Bilah mengambang di layar lebar justru menutupi konten saat men-scroll.
  - Karena `position: fixed` mengeluarkan elemen dari alur, **letaknya di markup tidak memengaruhi
    tampilan mobile** — itulah kenapa satu instance cukup, tak perlu duplikat komponen per breakpoint.
    Syaratnya: jangan letakkan di dalam ancestor ber-`transform`/`filter`/`backdrop-filter`
    (akan jadi containing block, lihat catatan `MenuDrawer`).
  - `<main>` memakai `pb-24 lg:pb-8`; `useStickyBarHeight(isMobile)` menahan `--sticky-bar-h` di 0
    saat desktop. Deteksi breakpoint pakai `useMediaQuery('(max-width: 1023px)')`, satu flag untuk
    dua keperluan (mode mengambang + bottom-sheet varian).
- **Deskripsi bisa dilipat** (`ProductDescription`, kini `'use client'`): dipotong 5 baris
  (`max-height: calc(5 * 1.625 * 0.875rem)` — dihitung dari `text-sm` × `leading-relaxed` agar
  memotong pas di batas baris), gradient fade putih di tepi bawah, tombol "Lihat Selengkapnya" ⇄
  "Sembunyikan", transisi `max-height` 300ms. Berlaku di semua viewport.
  - Deteksi "perlu tombol atau tidak" = `scrollHeight > clientHeight` diukur di **ref callback**
    (bukan `useEffect` — lint `react-hooks/set-state-in-effect` melarang `setState` di dalam efek),
    dengan `ResizeObserver` untuk perubahan lebar. **Jangan** menebak dari jumlah karakter: deskripsi
    berisi baris baru & baris pendek ("Isi bersih: 50 gr") sehingga panjang teks ≠ jumlah baris.
  - Pengukuran di-skip saat sedang terbuka (dijaga `expandedRef`); tanpa itu `scrollHeight ==
    clientHeight` dan tombolnya hilang sendiri begitu diklik.
  - Konsekuensi: tombol baru muncul **setelah hidrasi** (tak ada di HTML server). Tanpa JS deskripsi
    tetap terpotong 5 baris.

## Halaman Legal (Kebijakan Privasi & Syarat/Ketentuan) — SEDANG DINONAKTIFKAN

> **Status (2026-08-12): kedua halaman TIDAK bisa diakses.** Keputusan pemilik toko — dokumennya
> belum diperlukan sekarang. **KODENYA UTUH, JANGAN DIHAPUS**: `page.tsx` kedua rute,
> `LegalPageShell`, dan seluruh konstanta `lib/data/legal.ts` tetap ada & tetap ikut type-check.
>
> Tuas tunggal: **`LEGAL_PAGES_ENABLED`** di `src/lib/data/legal.ts` (kini `false`).
> - `false` → kedua rute memanggil `notFound()` (**HTTP 404**), section "Legal" + baris di bawah
>   copyright di footer disembunyikan, dan teks persetujuan di `CheckoutBottomBar` tak dirender.
> - Menghidupkan kembali: ubah satu nilai itu jadi `true`. Tak ada file yang perlu dibuat ulang.
> - Sebelum dinyalakan lagi, ganti dulu `LEGAL_CONTACT_EMAIL`/`LEGAL_CONTACT_PHONE` (masih
>   placeholder) dan perbarui `LEGAL_EFFECTIVE_DATE`.
>
> Catatan: `main` di `/checkout` masih `pb-32` (ruang untuk teks persetujuan). Aman — hanya sedikit
> ruang ekstra saat teksnya disembunyikan, dan tak perlu diubah dua kali saat halaman dinyalakan lagi.

Uraian di bawah menjelaskan halamannya saat AKTIF:

- Rute: `/privacy-policy` & `/terms-and-conditions` (Server Component, konten statis, di LUAR route
  group `(store)` → punya header hijau sendiri seperti `/pesanan-saya`).
- Kerangka bersama: **`src/components/legal/LegalPageShell.tsx`** — header + judul + tanggal berlaku,
  lalu **SATU kartu putih** berisi daftar isi anchor + seluruh `LegalSection`, dipisah garis tipis
  (`divide-y`) bukan kartu per topik. Tiap `LegalSection` = `py-5 last:pb-0` + `scroll-mt-20`
  (lebih besar dari tinggi header karena bab punya padding atas). Anak PERTAMA kartu adalah `<nav>`
  daftar isi, jadi jangan pasang `first:pt-0` di section. Plus `LegalList`, `LegalExternalLink`
  (selalu `target="_blank" rel="noopener noreferrer"`).
- Konstanta bersama: **`src/lib/data/legal.ts`** — `LEGAL_PAGES_ENABLED` (tuas aktif/nonaktif),
  `LEGAL_CONTACT_EMAIL`/`LEGAL_CONTACT_PHONE` (**PLACEHOLDER**, ganti sebelum go-live),
  `LEGAL_EFFECTIVE_DATE` (perbarui manual tiap revisi material), `PRIVACY_POLICY_PATH`/`TERMS_PATH`
  (dipakai footer + bilah checkout), `THIRD_PARTY_LINKS`.
- **Isi dokumen HARUS cermin implementasi nyata.** Saat alur data berubah, perbarui halamannya:
  field checkout (kini TANPA email — identitas = no_telepon), cookie/localStorage yang dipakai,
  pihak ketiga (Xendit, Mengantar, Google Analytics, Supabase), aturan pembatalan (hanya status
  `Menunggu Pembayaran`/`Diproses`).
- Tautan: footer beranda (section "Legal" + baris di bawah copyright) & `CheckoutBottomBar`
  (teks persetujuan di atas tombol bayar, tautan **tab baru** agar isian form tak hilang →
  karena itu `main` checkout memakai `pb-32`, bukan `pb-24`).

## Skala z-index (storefront) — patuhi saat menambah elemen mengambang

Elemen ber-`z-index` lebih besar **menyerap klik/tap** walau secara visual tampak di belakang.
Bug nyata yang pernah terjadi: bottom-sheet `z-50` di bawah `FloatingWhatsApp` `z-[60]` → tombol
"Terapkan filter" hanya bisa diklik di sisi kiri karena sisanya tertutup tombol WA.

| Lapis | z-index | Contoh |
|---|---|---|
| Konten & bilah aksi bawah | `z-10`–`z-40` | `StickyBuyBar` (40, **hanya < lg**), `CartCheckoutBar`/`CheckoutBottomBar` (30) |
| Header | `z-50` | `AppBar`, header halaman |
| Tombol mengambang | `z-[60]` | `FloatingWhatsApp` |
| Overlay & backdrop | `z-[70]` | backdrop `MenuDrawer`, overlay `HeaderSearch` mobile, `PhoneConfirmModal` |
| Panel modal/sheet | `z-[80]` | `BottomSheet` (filter/sort/varian/ongkir/pembayaran), panel `MenuDrawer` |

**Aturan:** apa pun yang menutupi layar dan menerima klik WAJIB ≥ `z-[70]` — di atas tombol
mengambang. Jangan menambah lapis baru tanpa memperbarui tabel ini.

## Halaman Maintenance (`/maintenance`)

- **`src/app/maintenance/page.tsx`** — Server Component statis, tanpa header/footer/navigasi.
  Isi: logo (non-tautan), ikon `Wrench` dalam lingkaran `bg-brand-light/30`, judul "Sedang Dalam
  Perbaikan", 2 paragraf, pemisah `bg-brand-primary`, tautan CS WhatsApp, copyright.
  `metadata.robots = { index: false, follow: false }` (kondisi sementara, jangan diindeks).
- Link CS memakai **`WHATSAPP_CS_LINK`** dari `src/lib/data/contact.ts` (dipindah dari dalam
  `FloatingWhatsApp.tsx` agar satu sumber). Masih placeholder `/404`.
- `FloatingWhatsApp` self-gate juga di `/maintenance` (halaman ini sudah punya tautan CS sendiri).
- **Belum ada mekanisme mengaktifkan maintenance mode** — halaman ini baru TAMPILAN. Untuk
  mengalihkan seluruh trafik ke sini, tambahkan rewrite ber-flag env di `src/proxy.ts`
  (mis. `MAINTENANCE_MODE=1`), kecualikan `/maintenance` sendiri + aset `_next/*` + `/oms/*` bila
  admin tetap perlu akses. Idealnya balas **HTTP 503** (bukan 200) agar mesin pencari tak menganggap
  situs hilang permanen — butuh route handler/response kustom, bukan `page.tsx` biasa.

## Floating WhatsApp CS

- **`FloatingWhatsApp`** (`components/ui/`, client) dipasang di **root `layout.tsx`** (bukan per halaman) → tampil di
  SEMUA halaman ecommerce; **self-gate**: `usePathname()` → `return null` di `/oms/*` (admin) dan `/checkout`
  (jangan ganggu proses bayar; `/checkout/success` tetap tampil).
- Tombol lingkaran hijau kanan bawah (`fixed right-5 z-[60]`) + ikon WhatsApp SVG inline (lucide tak punya brand icon).
- **Posisi vertikal mengikuti bilah aksi bawah**: `bottom: calc(1.25rem + var(--sticky-bar-h, 0px))` +
  `transition-[bottom]`. Variable diisi oleh bilah yang sedang tampil lewat hook
  **`useStickyBarHeight`** (`src/hooks/use-sticky-bar-height.ts`, ResizeObserver → set
  `--sticky-bar-h` di `<html>`, reset `0px` saat unmount). Dipakai `StickyBuyBar` (detail produk) &
  `CartCheckoutBar` (keranjang). **Halaman baru dengan bilah bawah cukup memanggil hook ini** —
  jangan hardcode tinggi atau daftar route di `FloatingWhatsApp`.
  Hook menerima argumen **`enabled`** (default `true`) untuk bilah yang mengambang hanya di sebagian
  breakpoint: saat `false`, variable ditahan `0px`. Dipakai `StickyBuyBar` (`useStickyBarHeight(isMobile)`)
  karena di desktop bilahnya statis — tanpa itu tombol WA terangkat tanpa ada yang perlu dihindari.
  Bubble "Pesan melalui CS kami" muncul ~2.5s, auto-hide, tombol × tutup permanen.
- **Link CS** = constant **`WHATSAPP_CS_LINK`** di `FloatingWhatsApp.tsx` (placeholder `/404`; ganti ke `https://wa.me/62…` saat siap).

