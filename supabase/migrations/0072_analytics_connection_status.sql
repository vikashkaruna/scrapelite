-- 0072_analytics_connection_status.sql — honest analytics connector lifecycle.
--
-- Saving encrypted credentials proves only that DatIQ can store the supplied
-- configuration. It does not prove that the provider accepted the token or
-- that a sync has completed. Older Stage 3 code labelled that state connected
-- and stamped last_sync_at, which overstated what had actually happened.

update public.audit_analytics_connections
set status = 'configured',
    last_sync_at = null
where status = 'connected';

alter table public.audit_analytics_connections
  alter column status set default 'configured';

alter table public.audit_analytics_connections
  drop constraint if exists audit_analytics_connections_status_check;

alter table public.audit_analytics_connections
  add constraint audit_analytics_connections_status_check
  check (status in ('configured', 'connected', 'error', 'disabled'));

comment on column public.audit_analytics_connections.status is
  'configured means encrypted credentials are saved; connected is reserved for a successful provider verification or sync.';

