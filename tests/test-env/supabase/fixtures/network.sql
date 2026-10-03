-- Jalankan setelah seed.sql. Idempoten: tidak menyegarkan timestamp saat diulang.
begin;
insert into public.mock_network_scenarios (id, description, onu_failure, upstream_failure) values
 ('normal','Semua ONU online; upstream up','none','none'),
 ('los_individual','Satu LOS dari sepuluh layanan pada ODP pertama','none','none'),
 ('los_area','Empat LOS dari delapan valid, total sepuluh pada ODP pertama','none','none'),
 ('low_coverage','Empat LOS dari enam valid, total sepuluh pada ODP pertama','none','none'),
 ('upstream_down','Upstream down dengan pemetaan eksplisit; ONU tetap online','none','none'),
 ('stale','Observasi ONU dan upstream berusia sepuluh menit','none','none'),
 ('unknown','Status ONU dan upstream unknown','none','none'),
 ('missing_status','Observasi ONU tidak tersedia','none','none'),
 ('future_timestamp','Observasi sepuluh menit di masa depan','none','none'),
 ('missing_timestamp','Status ada tetapi waktu observasi tidak ada','none','none'),
 ('provider_error','Kedua sumber gagal monitoring','error','error'),
 ('timeout','Kedua sumber melewati deadline pemeriksaan','timeout','timeout'),
 ('onu_error_upstream_down','ONU gagal; bukti upstream down tetap valid','error','none'),
 ('upstream_error_los','Upstream gagal; bukti LOS individu tetap valid','none','error'),
 ('recovered','Kejadian upstream telah pulih, identitas kejadian tetap','none','none'),
 ('new_event','Kejadian upstream baru memiliki identitas berbeda','none','none')
on conflict (id) do nothing;

insert into public.mock_onu_status (scenario_id,service_id,status,observed_at,event_id)
select s.id, ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 case
  when s.id in ('los_individual','upstream_error_los') and n=1 then 'LOS'
  when s.id in ('los_area','low_coverage') and n<=4 then 'LOS'
  when s.id='los_area' and n in (9,10) then 'unknown'
  when s.id='low_coverage' and n between 7 and 10 then 'unknown'
  when s.id='unknown' then 'unknown'
  else 'online' end,
 case when s.id='missing_timestamp' then null
  when s.id='stale' then now()-interval '10 minutes'
  when s.id='future_timestamp' then now()+interval '10 minutes'
  else now() end,
 case
  when s.id in ('los_individual','upstream_error_los') and n=1
    then '71000000-0000-4000-8000-000000000001'::uuid
  when s.id in ('los_area','low_coverage') and n<=4
    then '71000000-0000-4000-8000-000000000002'::uuid
  else null end
from public.mock_network_scenarios s cross join generate_series(1,12) fixture(n)
where s.id in ('normal','los_individual','los_area','low_coverage','upstream_down',
 'stale','unknown','future_timestamp','missing_timestamp','provider_error','timeout',
 'onu_error_upstream_down','upstream_error_los','recovered','new_event')
on conflict (scenario_id,service_id) do nothing;

insert into public.mock_upstream_status (scenario_id,link_id,status,observed_at,event_id)
select s.id, 'MOCK-UPLINK-01',
 case when s.id in ('upstream_down','onu_error_upstream_down','new_event') then 'down'
 when s.id='unknown' then 'unknown' else 'up' end,
 case when s.id='missing_timestamp' then null
 when s.id='stale' then now()-interval '10 minutes'
 when s.id='future_timestamp' then now()+interval '10 minutes' else now() end,
 case when s.id in ('upstream_down','onu_error_upstream_down','recovered')
 then '72000000-0000-4000-8000-000000000001'::uuid
 when s.id='new_event' then '72000000-0000-4000-8000-000000000002'::uuid
 else null end
from public.mock_network_scenarios s
where s.id in ('normal','los_individual','los_area','low_coverage','upstream_down',
 'stale','unknown','missing_status','future_timestamp','missing_timestamp',
 'provider_error','timeout','onu_error_upstream_down','upstream_error_los','recovered','new_event')
on conflict (scenario_id,link_id) do nothing;

insert into public.mock_upstream_impacts(scenario_id,link_id,service_id,mapping_version)
select s.scenario_id,s.link_id,
 ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,1
from public.mock_upstream_status s cross join generate_series(1,10) fixture(n)
where s.link_id='MOCK-UPLINK-01' and s.scenario_id in
 ('normal','los_individual','los_area','low_coverage','upstream_down',
 'stale','unknown','missing_status','future_timestamp','missing_timestamp',
 'provider_error','timeout','onu_error_upstream_down','upstream_error_los','recovered','new_event')
on conflict (scenario_id,link_id,service_id) do nothing;
commit;

