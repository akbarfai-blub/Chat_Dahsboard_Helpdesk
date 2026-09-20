select
    tablename,
    policyname,
    roles,
    cmd
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'customers',
      'services',
      'channel_identities',
      'odcs',
      'odps',
      'service_topology'
    )
  order by tablename, policyname;