-- supabase/migrations/20260828120000_add_orders_metode_pembayaran.sql
-- Simpan METODE PEMBAYARAN yang benar-benar dipakai pembeli di tabel orders.
--
-- ── Masalah yang ditutup ──
-- Checkout membawa pembeli ke halaman pembayaran Xendit yang menyediakan SEMUA metode (VA bank,
-- e-wallet, QRIS, retail). Pembeli memilih sendiri di sana — dan pilihannya tak pernah kembali ke
-- kita. Satu-satunya jejak Xendit di tabel `orders` adalah `id_transaksi`, yang tak memberi tahu
-- apa pun tentang cara bayarnya.
--
-- Yang tak bisa dijawab tanpa kolom ini:
--   * "Pembeli ini bayar pakai apa?" — harus buka dashboard Xendit satu per satu.
--   * "Metode apa yang paling sering dipakai?" Tanpa datanya, keputusan mengaktifkan/mematikan
--     channel di Xendit cuma tebakan.
--   * Rekonsiliasi: mutasi masuk dari VA BCA vs settlement QRIS punya jeda waktu & biaya berbeda;
--     tanpa tahu channel-nya, selisih saldo tak bisa dijelaskan.
--
-- ── Nilainya apa saja ──
-- Apa adanya dari Xendit, TIDAK dinormalisasi ke daftar putih kita sendiri: mis. 'BCA', 'BNI',
-- 'OVO', 'QRIS', 'ALFAMART', atau 'BANK_TRANSFER' bila Xendit hanya mengirim yang umum. Sengaja
-- text bebas tanpa CHECK daftar nilai — Xendit menambah channel kapan saja, dan constraint yang
-- ketinggalan akan menggagalkan penyimpanan status LUNAS pesanan yang uangnya sudah masuk.
--
-- ── Kapan terisi ──
-- HANYA saat callback pembayaran masuk (`POST /api/webhooks/xendit`). Bukan saat tagihan
-- diterbitkan: pada titik itu pembeli belum memilih apa pun. Jadi:
--   pesanan menunggu bayar  → NULL (belum dipilih)
--   pesanan lunas           → terisi
--   pesanan kedaluwarsa     → tetap NULL (tak pernah ada yang dibayar)
--   pesanan sebelum kolom   → NULL selamanya, TANPA backfill — datanya hanya ada di Xendit
--
-- NULL karena itu berarti "belum/tak pernah dibayar", bukan "datanya hilang".

alter table public.orders
  add column if not exists metode_pembayaran text;

comment on column public.orders.metode_pembayaran is
  'Metode/channel pembayaran yang DIPAKAI pembeli, apa adanya dari callback Xendit '
  '(mis. BCA, BNI, OVO, QRIS, ALFAMART). NULL = belum dibayar / pesanan sebelum kolom ini ada. '
  'Diisi HANYA oleh webhook pembayaran, bukan saat tagihan diterbitkan.';

-- Tak boleh string kosong. Alasannya bukan kerapian: '' dan NULL terlihat sama di UI tapi BERBEDA
-- di query (`is null` tak menangkap ''), jadi satu baris ber-'' cukup untuk membuat laporan
-- "pesanan yang belum dibayar" berbohong.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_metode_pembayaran_check') then
    alter table public.orders
      add constraint orders_metode_pembayaran_check
      check (metode_pembayaran is null or length(btrim(metode_pembayaran)) > 0);
  end if;
end $$;

-- Tanpa index. Kardinalitasnya sangat rendah (belasan channel) dan belum ada query yang menyaring
-- dengannya — agregasi "metode terpopuler" memindai seluruh tabel apa pun yang terjadi.
-- RPC `create_order_with_items` juga TIDAK diubah: kolom ini diisi jauh setelah pesanan tersimpan,
-- jadi menambahkannya sebagai parameter RPC hanya menambah parameter yang selalu NULL.
