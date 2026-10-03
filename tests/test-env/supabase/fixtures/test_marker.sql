-- Unique isolated test environment marker.
-- This marker is deployed ONLY in the dedicated test environment and proves isolation from user workspace.
begin;
insert into public.mock_network_scenarios (id, description, onu_failure, upstream_failure)
values ('test_env_isolated_marker', 'TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2', 'none', 'none')
on conflict (id) do update set description = 'TEST_ENVIRONMENT_ISOLATION_TOKEN_7F89B2';
commit;
