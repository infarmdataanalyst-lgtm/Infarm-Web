-- supabase/migrations/20260820130000_add_orders_shipment.sql
-- Status pembuatan shipment (booking kurir) Mengantar per pesanan.
--
-- Latar belakang: booking kurir dipicu SETELAH pembayaran sukses. Pada titik itu uang pembeli sudah
-- masuk, jadi kegagalan booking TIDAK boleh membatalkan pesanan — tapi juga tak boleh hilang tanpa
-- jejak. Tanpa kolom ini satu-satunya petunjuk adalah `no_tracking` yang kosong, dan itu tak bisa
-- dibedakan dari "pesanan baru yang memang belum dibooking".
--
-- Kolom yang sudah ada dan TIDAK diubah: nama_ekspedisi, jenis_layanan, no_tracking (nomor resi).

alter table public.orders
  add column if not exists shipment_status text,
  add column if not exists shipment_error text,
  add column if not exists shipment_booked_at timestamptz;

-- NULL = booking belum pernah dicoba (pesanan lama & pesanan yang belum dibayar).
-- Dibedakan dari 'FAILED' supaya admin bisa memisahkan "belum waktunya" dari "perlu ditindaklanjuti".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_shipment_status_check'
  ) then
    alter table public.orders
      add constraint orders_shipment_status_check
      check (shipment_status is null or shipment_status in ('BOOKED', 'FAILED'));
  end if;
end $$;

comment on column public.orders.shipment_status is
  'Status booking kurir Mengantar. NULL = belum pernah dicoba, BOOKED = resi terbit, '
  'FAILED = gagal dan PERLU DITINDAKLANJUTI MANUAL oleh admin (pembayaran sudah masuk).';

comment on column public.orders.shipment_error is
  'Alasan kegagalan booking terakhir (untuk admin OMS). Dikosongkan saat booking akhirnya berhasil.';

comment on column public.orders.shipment_booked_at is
  'Kapan booking berhasil. Dipakai membedakan resi dari Mengantar vs resi yang diisi admin manual.';

-- Index parsial: satu-satunya query yang butuh kolom ini adalah "tampilkan pesanan yang gagal
-- booking". Parsial supaya index tetap kecil — mayoritas baris NULL/BOOKED.
create index if not exists orders_shipment_failed_idx
  on public.orders (created_at desc)
  where shipment_status = 'FAILED';
