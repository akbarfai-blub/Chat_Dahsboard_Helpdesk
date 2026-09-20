-- MANUAL ONLY: refresh waktu observasi fixture, bukan status/event/topologi.
-- Tidak dijalankan oleh pembacaan provider atau seed ulang.
begin;
update public.mock_onu_status
set observed_at = case when scenario_id='missing_timestamp' then null
 when scenario_id='stale' then now()-interval '10 minutes'
 when scenario_id='future_timestamp' then now()+interval '10 minutes'
 else now() end
where scenario_id in ('normal','los_individual','los_area','low_coverage','upstream_down',
 'stale','unknown','missing_status','future_timestamp','missing_timestamp',
 'provider_error','timeout','onu_error_upstream_down','upstream_error_los','recovered','new_event');
update public.mock_upstream_status
set observed_at = case when scenario_id='missing_timestamp' then null
 when scenario_id='stale' then now()-interval '10 minutes'
 when scenario_id='future_timestamp' then now()+interval '10 minutes'
 else now() end
where scenario_id in ('normal','los_individual','los_area','low_coverage','upstream_down',
 'stale','unknown','missing_status','future_timestamp','missing_timestamp',
 'provider_error','timeout','onu_error_upstream_down','upstream_error_los','recovered','new_event');
commit;
