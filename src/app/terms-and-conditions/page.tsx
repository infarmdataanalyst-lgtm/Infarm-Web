// src/app/terms-and-conditions/page.tsx
// Halaman Syarat & Ketentuan. Server Component (konten statis).
// Isinya mengikuti alur nyata di kode: guest checkout, harga otoritatif dari server, cek ongkir
// Mengantar, pembayaran Xendit, aturan pembatalan (status Menunggu Pembayaran/Diproses saja).
// Kalau aturan bisnis berubah (mis. kebijakan refund final), PERBARUI halaman ini.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import LegalPageShell, {
  LegalSection,
  LegalList,
  LegalExternalLink,
  type LegalTocItem,
} from '@/components/legal/LegalPageShell'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_CONTACT_PHONE,
  LEGAL_PAGES_ENABLED,
  PRIVACY_POLICY_PATH,
  THIRD_PARTY_LINKS,
} from '@/lib/data/legal'

export const metadata: Metadata = {
  title: 'Syarat & Ketentuan — infarm.id',
  description:
    'Syarat & Ketentuan berbelanja di infarm.id: aturan checkout tanpa akun, harga dan promosi, pembayaran melalui Xendit, pengiriman melalui Mengantar, pembatalan dan pengembalian dana, serta batasan tanggung jawab.',
}

const TOC: LegalTocItem[] = [
  { id: 'penerimaan', label: 'Penerimaan Ketentuan' },
  { id: 'guest-checkout', label: 'Belanja Tanpa Akun & Tanggung Jawab Data' },
  { id: 'produk-harga', label: 'Produk, Harga & Ketersediaan' },
  { id: 'promosi', label: 'Promosi, Paket & Voucher' },
  { id: 'pesanan', label: 'Pembuatan Pesanan' },
  { id: 'pembayaran', label: 'Pembayaran melalui Xendit' },
  { id: 'pengiriman', label: 'Pengiriman melalui Mengantar' },
  { id: 'pembatalan', label: 'Pembatalan Pesanan' },
  { id: 'refund', label: 'Pengembalian Dana (Refund)' },
  { id: 'ulasan', label: 'Ulasan Produk' },
  { id: 'larangan', label: 'Penggunaan yang Dilarang' },
  { id: 'kekayaan-intelektual', label: 'Kekayaan Intelektual' },
  { id: 'tanggung-jawab', label: 'Batasan Tanggung Jawab' },
  { id: 'hukum', label: 'Hukum yang Berlaku & Penyelesaian Sengketa' },
  { id: 'perubahan', label: 'Perubahan Ketentuan' },
  { id: 'kontak', label: 'Kontak' },
]

export default function TermsAndConditionsPage() {
  // Halaman dinonaktifkan atas permintaan pemilik toko (dokumen belum diperlukan). Isi halaman di
  // bawah SENGAJA dipertahankan — hidupkan kembali dengan mengubah LEGAL_PAGES_ENABLED jadi true.
  if (!LEGAL_PAGES_ENABLED) notFound()

  return (
    <LegalPageShell
      title="Syarat & Ketentuan"
      intro="Ketentuan ini mengatur penggunaan situs infarm.id dan pembelian produk di dalamnya. Mohon dibaca sebelum Anda menyelesaikan pesanan. Karena infarm.id memakai sistem belanja tanpa akun (guest checkout), ketentuan ini berlaku setiap kali Anda melakukan transaksi."
      toc={TOC}
    >
      <LegalSection id="penerimaan" title="1. Penerimaan Ketentuan">
        <p>
          Dengan mengakses situs ini, memasukkan produk ke keranjang, atau menyelesaikan pembayaran,
          Anda menyatakan telah membaca, memahami, dan menyetujui Syarat &amp; Ketentuan ini beserta{' '}
          <Link
            href={PRIVACY_POLICY_PATH}
            className="font-medium text-brand-primary underline decoration-brand-light underline-offset-2"
          >
            Kebijakan Privasi
          </Link>{' '}
          kami. Jika Anda tidak menyetujuinya, mohon tidak melanjutkan transaksi.
        </p>
        <p>
          Anda menyatakan berusia 18 tahun atau lebih, atau telah cakap hukum untuk mengadakan
          perjanjian jual beli.
        </p>
      </LegalSection>

      <LegalSection id="guest-checkout" title="2. Belanja Tanpa Akun & Tanggung Jawab Data">
        <p>
          infarm.id tidak menyediakan pendaftaran akun pelanggan. Seluruh pesanan dibuat sebagai tamu,
          dan identitas Anda dikenali melalui <strong>nomor telepon</strong> yang Anda masukkan saat
          checkout. Konsekuensinya:
        </p>
        <LegalList
          items={[
            <>
              <strong>Ketepatan data adalah tanggung jawab Anda.</strong> Nama penerima, nomor
              telepon, dan alamat pengiriman harus benar dan lengkap. Kesalahan pengiriman akibat data
              yang salah, alamat tidak lengkap, atau nomor telepon tidak aktif bukan tanggung jawab
              kami, dan biaya pengiriman ulang menjadi beban Anda.
            </>,
            <>
              <strong>Nomor telepon adalah kunci akses pesanan Anda.</strong> Fitur lacak, batalkan,
              dan beri ulasan bekerja berdasarkan nomor tersebut. Jangan membagikan nomor invoice
              Anda kepada pihak yang tidak berkepentingan.
            </>,
            <>
              <strong>Simpan nomor invoice Anda.</strong> Karena tidak ada riwayat akun, nomor invoice
              adalah rujukan utama saat menghubungi kami.
            </>,
            <>
              <strong>Isi keranjang tersimpan di peramban Anda.</strong> Mengganti perangkat,
              memakai mode privat, atau menghapus data situs akan mengosongkan keranjang.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="produk-harga" title="3. Produk, Harga & Ketersediaan">
        <LegalList
          items={[
            'Foto produk bersifat ilustrasi. Perbedaan warna dan tampilan dapat terjadi karena pencahayaan, pengaturan layar, atau variasi alami produk pertanian seperti benih dan media tanam.',
            'Semua harga dicantumkan dalam Rupiah (IDR).',
            <>
              <strong>Harga yang berlaku adalah harga yang dihitung sistem kami pada saat pesanan
              dibuat.</strong>{' '}
              Harga divalidasi ulang di sisi server, sehingga harga yang tampil di peramban lama atau
              yang telah dimanipulasi tidak berlaku.
            </>,
            'Harga, deskripsi, dan ketersediaan produk dapat berubah tanpa pemberitahuan terlebih dahulu. Perubahan tidak berlaku surut atas pesanan yang telah dibayar.',
            <>
              <strong>Stok terbatas.</strong> Jika stok tidak mencukupi saat pesanan diproses,
              pesanan akan ditolak sistem dan Anda diminta menyesuaikan keranjang.
            </>,
            'Jika terjadi kekeliruan penulisan harga yang nyata dan tidak wajar, kami berhak membatalkan pesanan terkait dan mengembalikan dana yang telah dibayarkan.',
          ]}
        />
      </LegalSection>

      <LegalSection id="promosi" title="4. Promosi, Paket & Voucher">
        <LegalList
          items={[
            <>
              <strong>Promosi dapat berubah, dihentikan, atau berakhir sewaktu-waktu</strong> tanpa
              pemberitahuan terlebih dahulu, termasuk promo gratis ongkir, potongan harga, hadiah
              produk, dan harga paket/combo.
            </>,
            'Promosi hanya berlaku selama periode yang ditetapkan dan sepanjang syarat minimum pembelian terpenuhi pada saat pesanan dibuat.',
            'Kelayakan promosi dihitung ulang di sisi server saat pesanan dibuat. Promosi yang tampil di halaman namun tidak lagi memenuhi syarat atau telah kedaluwarsa tidak akan diterapkan.',
            'Produk hadiah promosi diberikan sepanjang stoknya tersedia dan tidak dapat ditukar dengan uang atau produk lain.',
            'Harga paket/combo berlaku untuk pembelian seluruh isi paket. Mengubah atau mengurangi isi paket membatalkan harga khusus tersebut.',
            'Kami berhak membatalkan pesanan dan/atau promosi yang diperoleh melalui penyalahgunaan, manipulasi sistem, atau tindakan tidak wajar lainnya.',
          ]}
        />
      </LegalSection>

      <LegalSection id="pesanan" title="5. Pembuatan Pesanan">
        <p>
          Pesanan terbentuk ketika Anda menekan tombol pembayaran dan sistem berhasil menerbitkan
          nomor invoice (format <code className="text-xs">INV-…</code>). Pada saat itu stok produk
          dialokasikan untuk Anda.
        </p>
        <p>
          Kami berhak menolak atau membatalkan pesanan, antara lain jika: stok tidak mencukupi, data
          pengiriman tidak valid, alamat tujuan tidak terlayani kurir, terdapat indikasi penipuan atau
          penyalahgunaan sistem, atau pembayaran tidak diselesaikan dalam batas waktu yang ditentukan.
        </p>
      </LegalSection>

      <LegalSection id="pembayaran" title="6. Pembayaran melalui Xendit">
        <LegalList
          items={[
            <>
              Pembayaran diproses oleh <strong>Xendit</strong> sebagai penyedia layanan pembayaran
              berlisensi. Metode yang tersedia (antara lain Virtual Account) ditampilkan pada halaman
              pembayaran.
            </>,
            <>
              <strong>Kami tidak menyimpan data kartu maupun kredensial perbankan Anda.</strong>{' '}
              Nomor kartu, PIN, OTP, dan data serupa dimasukkan langsung pada sistem Xendit dan tidak
              pernah kami terima. Kami hanya menerima status transaksi dan identitas transaksi.
            </>,
            'Pesanan akan diproses setelah pembayaran terkonfirmasi. Pesanan yang tidak dibayar sampai batas waktu yang ditentukan dapat dibatalkan otomatis dan stoknya dilepas kembali.',
            'Waktu konfirmasi pembayaran bergantung pada bank atau penyedia metode pembayaran Anda dan berada di luar kendali kami.',
            <>
              Ketentuan pihak Xendit:{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.xenditTerms}>
                Syarat &amp; Ketentuan Xendit
              </LegalExternalLink>{' '}
              ·{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.xenditPrivacy}>
                Kebijakan Privasi Xendit
              </LegalExternalLink>
            </>,
            <>
              <strong>Waspada penipuan.</strong> Kami tidak pernah meminta pembayaran ke rekening
              pribadi, tidak pernah meminta OTP atau PIN Anda, dan tidak pernah meminta pembayaran
              tambahan di luar total yang tertera pada halaman pembayaran.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="pengiriman" title="7. Pengiriman melalui Mengantar">
        <LegalList
          items={[
            <>
              Pengiriman dilakukan melalui mitra logistik <strong>Mengantar</strong> dan kurir yang
              tersedia pada layanan tersebut. Pilihan kurir serta biaya kirim ditampilkan berdasarkan
              alamat tujuan dan berat paket.
            </>,
            <>
              <strong>Biaya kirim dan estimasi waktu pengiriman berasal dari sistem kurir dan dapat
              berubah.</strong>{' '}
              Estimasi bersifat perkiraan, bukan jaminan. Keterlambatan dapat terjadi karena cuaca,
              hari libur, lonjakan volume kiriman, kendala operasional kurir, atau alamat yang sulit
              dijangkau.
            </>,
            <>
              <strong>Nomor resi tersedia setelah pesanan diproses dan diserahkan ke kurir</strong>,
              bukan segera setelah pembayaran. Anda dapat memantaunya melalui halaman lacak pesanan.
            </>,
            'Alamat tujuan yang tidak terlayani kurir mana pun tidak dapat diproses. Silakan pilih alamat lain atau hubungi kami.',
            'Risiko atas barang beralih kepada Anda pada saat paket diterima di alamat tujuan oleh Anda atau pihak yang berada di alamat tersebut.',
            'Periksa kondisi paket saat diterima. Kerusakan atau kekurangan isi wajib dilaporkan dalam 2×24 jam sejak paket diterima, disertai foto paket dan produk sebagai bukti.',
            <>
              Kebijakan pihak Mengantar:{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.mengantarPrivacy}>
                Kebijakan Privasi Mengantar
              </LegalExternalLink>
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="pembatalan" title="8. Pembatalan Pesanan">
        <p>
          Anda dapat membatalkan pesanan sendiri selama statusnya masih{' '}
          <strong>Menunggu Pembayaran</strong> atau <strong>Diproses</strong>, melalui halaman
          batalkan pesanan (dengan nomor telepon) atau tautan pembatalan yang Anda terima setelah
          checkout.
        </p>
        <p>
          Pesanan yang sudah berstatus <strong>Dikirim</strong> atau <strong>Selesai</strong>{' '}
          <strong>tidak dapat dibatalkan</strong> karena paket telah diserahkan kepada kurir. Untuk
          kasus tersebut, silakan tempuh mekanisme pengembalian pada bagian 9.
        </p>
        <p>
          Saat pembatalan berhasil, stok produk dilepas kembali dan status pesanan berubah menjadi
          Dibatalkan. Pembatalan bersifat final dan tidak dapat dibatalkan kembali — silakan buat
          pesanan baru bila berubah pikiran.
        </p>
      </LegalSection>

      <LegalSection id="refund" title="9. Pengembalian Dana (Refund)">
        <LegalList
          items={[
            'Pembatalan pesanan yang sudah dibayar akan diproses pengembalian dananya ke rekening atau metode pembayaran asal.',
            'Pengembalian dana diproses melalui penyedia pembayaran, sehingga waktu dana diterima bergantung pada bank atau penyedia metode pembayaran Anda.',
            'Pengembalian dana dapat diajukan untuk produk yang salah kirim, rusak saat diterima (dengan bukti sesuai bagian 7), atau tidak sesuai deskripsi.',
            'Pengembalian dana tidak berlaku untuk produk yang telah dibuka atau digunakan tanpa cacat produksi, kerusakan akibat kelalaian penyimpanan setelah diterima, atau ketidaksesuaian yang bersifat variasi alami produk pertanian.',
            'Biaya kirim tidak dikembalikan bila paket sudah diserahkan ke kurir, kecuali kesalahan berasal dari pihak kami.',
          ]}
        />
        <p>
          Ajukan permintaan pengembalian melalui kanal pada bagian 16 dengan menyertakan nomor
          invoice, nomor telepon pemesan, dan bukti pendukung.
        </p>
      </LegalSection>

      <LegalSection id="ulasan" title="10. Ulasan Produk">
        <p>
          Ulasan hanya dapat dikirim oleh pembeli yang riwayat pesanannya terverifikasi melalui nomor
          telepon, dan satu produk pada satu pesanan hanya dapat diulas satu kali. Ulasan bersifat
          publik.
        </p>
        <p>
          Dengan mengirim ulasan, Anda memberi kami izin menampilkan nama tampilan, rating, dan
          komentar Anda di situs. Kami berhak menyembunyikan atau menghapus ulasan yang memuat kata
          kasar, ujaran kebencian, promosi pihak lain, data pribadi, atau informasi yang menyesatkan.
        </p>
      </LegalSection>

      <LegalSection id="larangan" title="11. Penggunaan yang Dilarang">
        <p>Anda dilarang:</p>
        <LegalList
          items={[
            'Mengakses atau mencoba mengakses data pesanan milik orang lain, termasuk dengan menebak-nebak nomor telepon atau nomor invoice.',
            'Menggunakan program otomatis (bot, scraper, crawler) untuk mengambil data, memesan produk, mengirim ulasan, atau membanjiri layanan kami.',
            'Memanipulasi harga, total pembayaran, promosi, atau data pesanan.',
            'Mengganggu keamanan dan ketersediaan layanan, termasuk uji penetrasi tanpa izin tertulis dari kami.',
            'Menggunakan situs untuk tujuan melanggar hukum.',
          ]}
        />
        <p>
          Kami memantau dan membatasi jumlah percobaan pada endpoint publik. Pelanggaran dapat
          berujung pada pemblokiran akses, pembatalan pesanan, dan penempuhan langkah hukum.
        </p>
      </LegalSection>

      <LegalSection id="kekayaan-intelektual" title="12. Kekayaan Intelektual">
        <p>
          Seluruh merek, logo, nama produk, teks, foto, dan elemen desain pada situs ini adalah milik
          infarm atau pemberi lisensinya, dan dilindungi hukum. Anda tidak diperkenankan menyalin,
          memakai, atau memodifikasinya untuk keperluan komersial tanpa izin tertulis dari kami.
        </p>
      </LegalSection>

      <LegalSection id="tanggung-jawab" title="13. Batasan Tanggung Jawab">
        <p>
          Sepanjang diizinkan hukum yang berlaku, tanggung jawab kami atas suatu pesanan dibatasi
          maksimal sebesar nilai yang Anda bayarkan untuk pesanan tersebut.
        </p>
        <p>
          <strong>Layanan pihak ketiga.</strong> Pembayaran diproses oleh Xendit dan pengiriman
          dilaksanakan oleh Mengantar beserta kurir mitranya. Keduanya adalah penyedia independen
          dengan syarat dan kebijakan masing-masing. Kami tidak bertanggung jawab atas kerugian yang
          timbul dari, antara lain: gangguan atau pemeliharaan sistem pembayaran, keterlambatan
          konfirmasi dana oleh bank, keterlambatan atau kegagalan pengiriman oleh kurir, kehilangan
          atau kerusakan paket selama dalam penguasaan kurir, serta ketidaktepatan estimasi biaya dan
          waktu kirim yang dihasilkan sistem mitra logistik. Untuk kejadian semacam itu kami akan
          membantu menjembatani klaim Anda kepada mitra yang bersangkutan.
        </p>
        <p>
          Kami juga tidak bertanggung jawab atas kerugian tidak langsung, kehilangan keuntungan,
          kegagalan panen, atau kerugian konsekuensial lainnya yang timbul dari penggunaan produk,
          karena hasil budi daya tanaman dipengaruhi banyak faktor di luar kendali kami seperti
          cuaca, media tanam, air, dan perawatan.
        </p>
        <p>
          Situs disediakan sebagaimana adanya. Kami tidak menjamin layanan bebas dari gangguan atau
          kesalahan, namun berupaya wajar untuk memperbaikinya.
        </p>
      </LegalSection>

      <LegalSection id="hukum" title="14. Hukum yang Berlaku & Penyelesaian Sengketa">
        <p>
          Ketentuan ini diatur dan ditafsirkan berdasarkan hukum <strong>Republik Indonesia</strong>,
          termasuk peraturan mengenai perdagangan melalui sistem elektronik dan pelindungan konsumen.
        </p>
        <p>
          Setiap sengketa akan diupayakan diselesaikan terlebih dahulu secara musyawarah dalam waktu
          30 hari sejak pemberitahuan tertulis. Bila tidak tercapai kesepakatan, sengketa diselesaikan
          melalui pengadilan yang berwenang di wilayah hukum Republik Indonesia. Ketentuan ini tidak
          menghapus hak Anda sebagai konsumen menurut peraturan yang berlaku.
        </p>
      </LegalSection>

      <LegalSection id="perubahan" title="15. Perubahan Ketentuan">
        <p>
          Kami dapat mengubah Syarat &amp; Ketentuan ini sewaktu-waktu, termasuk ketika kami menambah
          metode pembayaran atau mitra pengiriman baru. Versi terbaru berlaku sejak ditayangkan di
          halaman ini dengan tanggal pembaruan di bagian atas. Ketentuan yang berlaku atas suatu
          pesanan adalah ketentuan yang tayang pada saat pesanan itu dibuat.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="16. Kontak">
        <LegalList
          items={[
            <>
              Email: <strong>{LEGAL_CONTACT_EMAIL}</strong>
            </>,
            <>
              WhatsApp/telepon: <strong>{LEGAL_CONTACT_PHONE}</strong>
            </>,
          ]}
        />
        <p>
          Saat menghubungi kami mengenai pesanan, sertakan <strong>nomor invoice</strong> dan{' '}
          <strong>nomor telepon</strong> yang dipakai saat checkout agar penanganan lebih cepat.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
