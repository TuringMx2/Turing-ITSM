# Infrastructure

V1 uses managed Supabase services first and keeps local infrastructure minimal.

## Now

- **PostgreSQL**: Supabase Postgres stores tenants, users/profiles, tickets, comments, assets, SLA policies, audit events, and reporting data.
- **Auth**: Supabase Auth provides login/session primitives. The API must still enforce tenant and role authorization for every operation.
- **Storage**: Supabase Storage can hold ticket attachments with signed URLs and tenant/ticket authorization checks.

## Later

- **Redis**: SLA timers, queues, notification fanout, rate limits, and short-lived cache.
- **Worker**: background email, alerting, SLA breach detection, attachment processing, and scheduled reports.
- **Object storage abstraction**: keep the attachment domain portable enough to move from Supabase Storage to S3-compatible storage if needed.

## Security baseline

- Every tenant-scoped table should include `tenant_id`.
- Supabase RLS policies and backend authorization should both prevent cross-tenant data access.
- Service-role keys must never be exposed to the browser or committed.
