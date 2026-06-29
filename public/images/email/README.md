# Aset gambar untuk email

Folder ini menampung gambar yang dipakai template email (`src/emails/*.html`).

## Logo header — `logo-infarm.png`

Letakkan logo resmi Infarm di sini dengan nama **`logo-infarm.png`**:

```
public/images/email/logo-infarm.png
```

Otomatis tersaji di:

- Lokal: `http://localhost:3000/images/email/logo-infarm.png`
- Produksi: `https://<domain>/images/email/logo-infarm.png`

Spesifikasi yang disarankan:

- Format **PNG transparan**, versi **putih** (kontras di atas header hijau `#46b33c`).
- Lebar file ~300px (ditampilkan 150px → tajam di layar retina).

> Penting: saat email dikirim sungguhan, `{{logo_url}}` harus diisi **URL absolut**
> (`https://...`), bukan path relatif — karena mail client penerima tidak berada di origin kita.
> Path relatif `/images/email/logo-infarm.png` hanya berfungsi untuk preview lokal di browser.

## Hero image (opsional)

Foto tanaman basil untuk hero bisa ditaruh di sini juga (mis. `hero-basil.jpg`),
lalu ganti `src` placeholder di template dengan URL absolutnya.
