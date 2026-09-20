-- Fixture lokal; ID Telegram bukan ID akun nyata. Tidak menyentuh auth.users.
-- ID tetap + DO NOTHING: pengulangan seed tidak menimpa hasil latihan.
-- Konflik natural key dengan ID lain menggagalkan transaksi, bukan menautkan akun diam-diam.
begin;
insert into public.odcs (id, odc_code, display_name)
values ('30000000-0000-4000-8000-000000000001', 'ODC-DUMMY-01', 'ODC Simulasi Utama')
on conflict (id) do nothing;

insert into public.odps (id, odc_id, odp_code, display_name)
values
 ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'ODP-DUMMY-01', 'ODP Simulasi A'),
 ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'ODP-DUMMY-02', 'ODP Simulasi B')
on conflict (id) do nothing;

insert into public.customers (id, customer_code, display_name)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'DUMMY-CUST-' || lpad(n::text,3,'0'), 'Pelanggan Dummy ' || lpad(n::text,2,'0')
from generate_series(1,12) fixture(n)
on conflict (id) do nothing;

insert into public.services (id, customer_id, service_code, display_name)
select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'DUMMY-SVC-' || lpad(n::text,3,'0'), 'Layanan Internet Dummy ' || lpad(n::text,2,'0')
from generate_series(1,12) fixture(n)
on conflict (id) do nothing;

insert into public.service_topology (id, service_id, odp_id, mapping_version, source, valid_from)
select ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 case when n<=10 then '40000000-0000-4000-8000-000000000001'::uuid
 else '40000000-0000-4000-8000-000000000002'::uuid end,
 1, 'MOCK', '2026-09-20T00:00:00Z'::timestamptz
from generate_series(1,12) fixture(n)
on conflict (id) do nothing;

insert into public.channel_identities
 (id, channel, channel_account_id, sender_external_id, display_name_snapshot,
 customer_id, verification_status, verified_at)
select ('60000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'telegram', 'dummy-bot-upaznet', 'dummy-sender-' || lpad(n::text,3,'0'),
 'Pengirim Dummy ' || lpad(n::text,2,'0'),
 ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'verified', '2026-09-20T00:00:00Z'::timestamptz
from generate_series(1,4) fixture(n)
on conflict (id) do nothing;

insert into public.channel_identities
 (id, channel, channel_account_id, sender_external_id, display_name_snapshot)
values ('60000000-0000-4000-8000-000000000005', 'telegram',
 'dummy-bot-upaznet', 'dummy-sender-unknown', 'Pengirim Dummy Belum Dikenal')
on conflict (id) do nothing;
commit;

