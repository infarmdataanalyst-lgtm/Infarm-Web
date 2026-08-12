// src/app/privacy-policy/page.tsx
// Halaman Kebijakan Privasi. Server Component (konten statis).
// Isi dokumen mencerminkan implementasi NYATA di kode: field yang benar-benar dikumpulkan saat
// checkout, cookie/localStorage yang benar-benar dipakai, dan pihak ketiga yang benar-benar
// menerima data. Kalau alur data berubah (mis. Xendit go-live, field baru), PERBARUI halaman ini.

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
  TERMS_PATH,
  THIRD_PARTY_LINKS,
} from '@/lib/data/legal'

export const metadata: Metadata = {
  title: 'Kebijakan Privasi — infarm.id',
  description:
    'Kebijakan Privasi infarm.id: data apa yang kami kumpulkan saat checkout tanpa akun, bagaimana kami menyimpannya, dengan siapa kami membagikannya (Xendit, Mengantar), dan hak Anda atas data tersebut.',
}

const TOC: LegalTocItem[] = [
  { id: 'ringkasan', label: 'Ringkasan Singkat' },
  { id: 'data-checkout', label: 'Data yang Kami Kumpulkan saat Checkout' },
  { id: 'data-perangkat', label: 'Data yang Disimpan di Perangkat Anda' },
  { id: 'data-server', label: 'Data yang Disimpan di Server Kami' },
  { id: 'ulasan', label: 'Data Ulasan Produk' },
  { id: 'tujuan', label: 'Tujuan Penggunaan Data' },
  { id: 'pihak-ketiga', label: 'Berbagi Data dengan Pihak Ketiga' },
  { id: 'cookie', label: 'Cookie & Teknologi Serupa' },
  { id: 'retensi', label: 'Retensi Data' },
  { id: 'keamanan', label: 'Keamanan Data' },
  { id: 'hak-anda', label: 'Hak Anda atas Data' },
  { id: 'anak', label: 'Privasi Anak' },
  { id: 'perubahan', label: 'Perubahan Kebijakan' },
  { id: 'kontak', label: 'Kontak' },
]

export default function PrivacyPolicyPage() {
  // Halaman dinonaktifkan atas permintaan pemilik toko (dokumen belum diperlukan). Isi halaman di
  // bawah SENGAJA dipertahankan — hidupkan kembali dengan mengubah LEGAL_PAGES_ENABLED jadi true.
  if (!LEGAL_PAGES_ENABLED) notFound()

  return (
    <LegalPageShell
      title="Kebijakan Privasi"
      intro="Kebijakan ini menjelaskan data apa yang infarm.id kumpulkan ketika Anda berbelanja, bagaimana data itu kami simpan dan gunakan, kepada siapa data dibagikan, serta hak Anda atas data tersebut. infarm.id tidak menggunakan sistem akun pelanggan — Anda berbelanja sebagai tamu (guest checkout), sehingga data yang kami minta hanya sebatas yang dibutuhkan untuk memproses dan mengirim pesanan."
      toc={TOC}
    >
      <LegalSection id="ringkasan" title="1. Ringkasan Singkat">
        <LegalList
          items={[
            <>
              <strong>Tanpa akun.</strong> Tidak ada pendaftaran, kata sandi, atau profil pelanggan.
              Anda tidak perlu membuat akun untuk berbelanja.
            </>,
            <>
              <strong>Data minimum.</strong> Kami hanya meminta data yang dibutuhkan untuk mengirim
              pesanan: nama penerima, nomor telepon, dan alamat pengiriman.
            </>,
            <>
              <strong>Keranjang tersimpan di perangkat Anda,</strong> bukan di server kami.
            </>,
            <>
              <strong>Kami tidak menjual data Anda</strong> dan tidak membagikannya untuk keperluan
              pemasaran pihak lain.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="data-checkout" title="2. Data yang Kami Kumpulkan saat Checkout">
        <p>
          Ketika Anda menyelesaikan pesanan, kami mengumpulkan dan menyimpan data berikut pada
          catatan pesanan Anda:
        </p>
        <LegalList
          items={[
            <>
              <strong>Nama penerima</strong> (<code className="text-xs">nama_customer</code>) — untuk
              identifikasi penerima paket.
            </>,
            <>
              <strong>Nomor telepon</strong> (<code className="text-xs">no_telepon</code>) — untuk
              notifikasi pengiriman, kontak kurir, dan sebagai penanda identitas Anda saat melacak,
              membatalkan, atau mengulas pesanan.
            </>,
            <>
              <strong>Alamat pengiriman lengkap</strong> (
              <code className="text-xs">shipping_address</code>) beserta{' '}
              <strong>provinsi, kota/kabupaten, kecamatan, kelurahan,</strong> dan{' '}
              <strong>kode pos</strong> — untuk perhitungan biaya kirim dan pengiriman paket.
            </>,
            <>
              <strong>Pilihan kurir & layanan pengiriman</strong> (
              <code className="text-xs">nama_ekspedisi</code>,{' '}
              <code className="text-xs">jenis_layanan</code>) serta{' '}
              <strong>kode wilayah tujuan</strong> (
              <code className="text-xs">destination_id</code>).
            </>,
            <>
              <strong>Rincian pesanan</strong> — produk, jumlah, dan harga pada saat pembelian.
            </>,
            <>
              <strong>Nomor resi</strong> (<code className="text-xs">no_tracking</code>) dan{' '}
              <strong>identitas transaksi pembayaran</strong> (
              <code className="text-xs">id_transaksi</code>) — dibuat setelah pesanan diproses.
            </>,
          ]}
        />
        <p>
          <strong>Alamat email:</strong> formulir checkout kami{' '}
          <strong>tidak lagi meminta alamat email</strong>. Kolom email masih ada pada basis data
          kami semata-mata untuk menyimpan pesanan lama yang dibuat ketika field tersebut masih
          digunakan; pesanan baru tidak menyimpan email apa pun.
        </p>
        <p>
          Kami tidak meminta data yang tidak diperlukan — tidak ada nomor identitas kependudukan,
          tanggal lahir, data biometrik, maupun data lokasi presisi.
        </p>
      </LegalSection>

      <LegalSection id="data-perangkat" title="3. Data yang Disimpan di Perangkat Anda">
        <p>
          Sebagian data belanja disimpan <strong>hanya di peramban Anda</strong> (cookie dan
          localStorage) dan tidak dikirim ke server kami kecuali Anda menyelesaikan pesanan:
        </p>
        <LegalList
          items={[
            <>
              <strong>Isi keranjang</strong> — ID produk, jumlah, dan harga. Disimpan sebagai cookie.
              Kami tidak menyimpan data pribadi di dalam cookie keranjang.
            </>,
            <>
              <strong>Item terpilih menuju checkout</strong> dan{' '}
              <strong>catatan promo/paket yang tercapai</strong> — cookie sementara agar halaman
              checkout menampilkan pesanan yang benar.
            </>,
            <>
              <strong>Nomor telepon Anda sendiri</strong> — disimpan sebagai cookie selama 30 hari
              setelah checkout berhasil, agar Anda tidak perlu mengetik ulang nomor saat melacak atau
              membatalkan pesanan. Cookie ini hanya berisi nomor telepon; status dan isi pesanan
              selalu diambil ulang dari server, tidak disimpan di perangkat.
            </>,
            <>
              <strong>Estimasi jumlah pesanan aktif</strong> — angka pada ikon akun di header.
            </>,
            <>
              <strong>Riwayat produk yang pernah Anda lihat</strong> — maksimal 10 produk terakhir,
              disimpan di localStorage untuk menampilkan bagian &ldquo;Dilihat Sebelumnya&rdquo;.
            </>,
          ]}
        />
        <p>
          Anda dapat menghapus semua data ini kapan saja dengan membersihkan cookie dan data situs
          untuk infarm.id dari pengaturan peramban Anda. Menghapusnya tidak memengaruhi pesanan yang
          sudah dibuat.
        </p>
      </LegalSection>

      <LegalSection id="data-server" title="4. Data yang Disimpan di Server Kami">
        <p>
          Data yang tersimpan di server kami (basis data Supabase) terbatas pada catatan pesanan dan
          rincian itemnya: data penerima dan alamat sebagaimana disebut pada bagian 2, status
          pembayaran, status pesanan, nomor invoice, nomor resi, serta produk dan harga pada saat
          pembelian.
        </p>
        <p>
          Tabel pesanan dilindungi dan <strong>tidak dapat diakses langsung dari peramban</strong>.
          Semua pembacaan dan penulisan data pesanan dilakukan melalui server kami. Fitur lacak dan
          batalkan pesanan berbasis nomor telepon hanya menampilkan informasi terbatas dan{' '}
          <strong>menyamarkan nama penerima</strong>, serta dibatasi jumlah percobaannya untuk
          mencegah penyalahgunaan oleh pihak yang menebak-nebak nomor telepon orang lain.
        </p>
      </LegalSection>

      <LegalSection id="ulasan" title="5. Data Ulasan Produk">
        <p>
          Jika Anda mengirim ulasan produk, kami menyimpan <strong>nama tampilan</strong> yang Anda
          isi, <strong>rating</strong>, dan <strong>komentar</strong> Anda. Ulasan bersifat{' '}
          <strong>publik</strong> dan ditampilkan pada halaman produk, karena itu jangan menuliskan
          data pribadi (nomor telepon, alamat, atau informasi sensitif lain) di dalam komentar.
        </p>
        <p>
          Ulasan hanya dapat dikirim oleh pembeli yang riwayat pesanannya terverifikasi lewat nomor
          telepon, dan ditinjau oleh admin kami. Kami dapat menyembunyikan ulasan yang melanggar
          ketentuan tanpa pemberitahuan lebih dahulu. Nama tampilan yang Anda pakai boleh berupa nama
          panggilan.
        </p>
      </LegalSection>

      <LegalSection id="tujuan" title="6. Tujuan Penggunaan Data">
        <LegalList
          items={[
            'Memproses, mengemas, dan mengirimkan pesanan Anda.',
            'Menghitung biaya pengiriman ke alamat tujuan Anda.',
            'Memproses pembayaran dan memverifikasi status transaksi.',
            'Memberi Anda akses untuk melacak, membatalkan, atau mengulas pesanan tanpa perlu akun.',
            'Melayani pertanyaan dan keluhan Anda.',
            'Menjaga keamanan layanan, termasuk mencegah penyalahgunaan dan aktivitas otomatis (bot).',
            'Memenuhi kewajiban hukum, pembukuan, dan perpajakan.',
          ]}
        />
      </LegalSection>

      <LegalSection id="pihak-ketiga" title="7. Berbagi Data dengan Pihak Ketiga">
        <p>
          Kami membagikan data hanya sebatas yang diperlukan agar layanan berjalan. Kami{' '}
          <strong>tidak menjual</strong> data Anda dan tidak membagikannya untuk pemasaran pihak
          lain. Pihak ketiga berikut memproses sebagian data Anda:
        </p>

        <div className="space-y-3">
          <div className="rounded-xl bg-brand-surface p-3">
            <p className="font-bold text-zinc-900">Xendit — pemroses pembayaran</p>
            <p className="mt-1">
              Ketika Anda melakukan pembayaran, data yang diperlukan untuk membuat dan memverifikasi
              transaksi (antara lain nominal, identitas pesanan, dan data kontak yang dibutuhkan
              metode pembayaran) diproses oleh Xendit. Data instrumen pembayaran Anda — nomor kartu,
              PIN, atau kredensial perbankan — <strong>dimasukkan langsung pada sistem Xendit dan
              tidak pernah kami terima maupun kami simpan</strong>.
            </p>
            <p className="mt-1">
              Kebijakan Xendit:{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.xenditPrivacy}>
                Kebijakan Privasi Xendit
              </LegalExternalLink>{' '}
              ·{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.xenditTerms}>
                Syarat &amp; Ketentuan Xendit
              </LegalExternalLink>
            </p>
          </div>

          <div className="rounded-xl bg-brand-surface p-3">
            <p className="font-bold text-zinc-900">Mengantar — layanan logistik</p>
            <p className="mt-1">
              Saat Anda mencari alamat dan memeriksa biaya kirim, kami mengirimkan kata kunci
              pencarian wilayah, kode wilayah tujuan, dan berat paket ke Mengantar. Saat pesanan
              dikirim, data penerima yang diperlukan kurir — nama, nomor telepon, dan alamat
              pengiriman — diteruskan untuk keperluan pengantaran dan pelacakan.
            </p>
            <p className="mt-1">
              Kebijakan Mengantar:{' '}
              <LegalExternalLink href={THIRD_PARTY_LINKS.mengantarPrivacy}>
                Kebijakan Privasi Mengantar
              </LegalExternalLink>
            </p>
          </div>

          <div className="rounded-xl bg-brand-surface p-3">
            <p className="font-bold text-zinc-900">Google Analytics — statistik kunjungan</p>
            <p className="mt-1">
              Kami menggunakan Google Analytics 4 untuk memahami cara pengunjung memakai situs
              (halaman yang dilihat, produk yang dibuka, produk yang dimasukkan ke keranjang). Data
              ini bersifat statistik dan tidak berisi nama, nomor telepon, atau alamat Anda.
              Analytics tidak dijalankan di area administrasi internal kami.
            </p>
          </div>

          <div className="rounded-xl bg-brand-surface p-3">
            <p className="font-bold text-zinc-900">Penyedia infrastruktur</p>
            <p className="mt-1">
              Situs dan basis data kami dijalankan pada layanan hosting dan basis data pihak ketiga
              (antara lain Supabase sebagai penyedia basis data). Mereka memproses data atas instruksi
              kami sebagai penyedia infrastruktur, bukan untuk kepentingan mereka sendiri.
            </p>
          </div>
        </div>

        <p>
          Selain itu, kami dapat mengungkapkan data jika diwajibkan oleh hukum, perintah pengadilan,
          atau permintaan resmi aparat yang berwenang.
        </p>
      </LegalSection>

      <LegalSection id="cookie" title="8. Cookie & Teknologi Serupa">
        <p>Kami memakai cookie untuk dua tujuan saja:</p>
        <LegalList
          items={[
            <>
              <strong>Cookie fungsional (wajib).</strong> Menyimpan isi keranjang, item yang dibawa
              ke checkout, nomor telepon Anda untuk kemudahan melacak pesanan, dan estimasi jumlah
              pesanan aktif. Tanpa cookie ini, keranjang dan checkout tidak dapat berfungsi.
            </>,
            <>
              <strong>Cookie analitik.</strong> Dipasang oleh Google Analytics untuk statistik
              kunjungan sebagaimana dijelaskan pada bagian 7.
            </>,
          ]}
        />
        <p>
          Kami tidak memasang cookie iklan dan tidak melakukan penargetan iklan lintas situs. Anda
          dapat memblokir atau menghapus cookie melalui pengaturan peramban, dengan konsekuensi
          fitur keranjang dan checkout tidak berjalan sebagaimana mestinya.
        </p>
      </LegalSection>

      <LegalSection id="retensi" title="9. Retensi Data">
        <LegalList
          items={[
            <>
              <strong>Data pesanan</strong> disimpan selama diperlukan untuk pemenuhan pesanan,
              penanganan keluhan/garansi, serta pembukuan dan kewajiban perpajakan.
            </>,
            <>
              <strong>Ulasan produk</strong> disimpan selama ulasan masih ditampilkan pada halaman
              produk.
            </>,
            <>
              <strong>Data di perangkat Anda</strong>: cookie keranjang bertahan sampai Anda
              menghapusnya; cookie nomor telepon kedaluwarsa otomatis dalam 30 hari; riwayat produk
              yang dilihat dibatasi 10 entri terakhir.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="keamanan" title="10. Keamanan Data">
        <p>
          Kami menerapkan langkah teknis yang wajar untuk melindungi data Anda: akses ke basis data
          dibatasi pada sisi server, tabel pesanan tidak terbuka untuk publik, area administrasi
          dilindungi autentikasi, tautan pembatalan pesanan diverifikasi dengan token, dan endpoint
          publik dibatasi jumlah percobaannya untuk menahan aktivitas otomatis.
        </p>
        <p>
          Meskipun demikian, tidak ada metode transmisi atau penyimpanan elektronik yang sepenuhnya
          aman. Kami tidak dapat menjamin keamanan absolut, namun akan menangani setiap insiden
          sesuai ketentuan hukum yang berlaku.
        </p>
      </LegalSection>

      <LegalSection id="hak-anda" title="11. Hak Anda atas Data">
        <p>Sesuai peraturan pelindungan data pribadi di Indonesia, Anda berhak untuk:</p>
        <LegalList
          items={[
            'Meminta informasi mengenai data pribadi Anda yang kami simpan.',
            'Meminta perbaikan data yang tidak akurat — misalnya alamat pengiriman yang salah tulis, selama pesanan belum dikirim.',
            'Meminta penghapusan data, sepanjang tidak bertentangan dengan kewajiban penyimpanan dokumen transaksi.',
            'Menarik kembali persetujuan atas pemrosesan yang bersifat opsional.',
            'Mengajukan keberatan atau keluhan atas cara kami memproses data Anda.',
          ]}
        />
        <p>
          Ajukan permintaan melalui kanal pada bagian 14. Untuk melindungi data Anda, kami dapat
          meminta konfirmasi nomor telepon dan nomor invoice pesanan sebelum memenuhi permintaan.
          Anda juga dapat memeriksa status pesanan sendiri kapan saja melalui halaman lacak pesanan
          tanpa menghubungi kami.
        </p>
      </LegalSection>

      <LegalSection id="anak" title="12. Privasi Anak">
        <p>
          Layanan ini ditujukan untuk pengguna berusia 18 tahun ke atas atau yang telah cakap hukum
          untuk melakukan transaksi. Kami tidak secara sengaja mengumpulkan data anak. Jika Anda orang
          tua atau wali dan mengetahui anak Anda mengirimkan data kepada kami, hubungi kami agar data
          tersebut dapat dihapus.
        </p>
      </LegalSection>

      <LegalSection id="perubahan" title="13. Perubahan Kebijakan">
        <p>
          Kami dapat memperbarui kebijakan ini seiring perkembangan layanan, misalnya ketika kami
          menambah mitra pembayaran atau logistik. Versi terbaru selalu ditayangkan di halaman ini
          dengan tanggal pembaruan di bagian atas. Perubahan yang bersifat material akan kami
          umumkan pada situs. Dengan terus menggunakan layanan setelah pembaruan, Anda dianggap
          menyetujui kebijakan yang berlaku.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="14. Kontak">
        <p>
          Pertanyaan atau permintaan terkait data pribadi Anda dapat disampaikan melalui:
        </p>
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
          Lihat juga{' '}
          <Link
            href={TERMS_PATH}
            className="font-medium text-brand-primary underline decoration-brand-light underline-offset-2"
          >
            Syarat &amp; Ketentuan
          </Link>{' '}
          kami.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
