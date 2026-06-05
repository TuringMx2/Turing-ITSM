# Database baseline

This project uses Supabase PostgreSQL/Auth/Storage as the first managed data layer.

## Local migration

The first schema baseline lives at:

```txt
supabase/migrations/20260605_initial_itsm_schema.sql
```

It is a local migration artifact only. It has **not** been applied to a remote Supabase project from this repository session.

The migration defines:

- RBAC enums matching the frontend role strings: `customer_user`, `customer_manager`, `support_agent`, `admin`.
- Ticket priority enum constrained to exactly: `low`, `moderate`, `high`, `urgent`.
- Ticket statuses for the operational workflow: `new`, `assigned`, `in_progress`, `waiting_customer`, `waiting_internal`, `escalated`, `resolved`, `closed`, `cancelled`.
- Tenant and profile tables linked to `auth.users` through `profiles.id`.
- Permission and role-permission seed rows aligned with `apps/web/lib/rbac.ts`.
- Customer ticket fields as direct columns: `submitter_name`, `company_name`, `department`, `subject`, `priority`, `description`.
- Separate visibility flags for public/internal comments and attachments.
- Audit events for operational and administrative traceability.
- Indexes, timestamp triggers, tenant-consistency triggers, and conservative RLS policies.

## Attachment storage

Binary files should live in Supabase Storage, not in Postgres. Postgres stores only attachment metadata in `public.ticket_attachments`.

Recommended bucket:

```txt
ticket-attachments
```

Recommended object path convention:

```txt
{tenant_id}/{ticket_id}/{attachment_id}-{safe_original_filename}
```

The metadata row should store:

- `ticket_id`
- `tenant_id`
- `uploaded_by_user_id`
- `visibility`: `public` or `internal`
- `bucket`: always `ticket-attachments`
- `storage_path`
- `file_name`
- `mime_type`
- `size_bytes`

Files should be served through signed URLs after checking ticket visibility and attachment visibility. The bucket should not be public. Service-role keys must never be exposed in the browser.

## RLS notes

RLS is enabled for tenant, profile, permission, ticket, comment, attachment, and audit tables.

Ticket visibility follows the RBAC document:

- `customer_user`: only tickets created by that user in the same tenant.
- `customer_manager`: all tickets in the same tenant.
- `support_agent`: operational access to tickets across tenants.
- `admin`: global access.

Customer roles can only read comments and attachments where `visibility = 'public'`. Internal comments/notes and internal attachments are visible only to `support_agent` and `admin`.

RLS is a database safety layer. Backend endpoints must still enforce role, permission, and resource-scope checks before writes and before generating Storage signed URLs.

For the first baseline, direct customer table updates are intentionally conservative: customers can create tickets, read according to tenant/ownership scope, and add public comments/attachments to visible tickets. Editing submitted ticket fields while a ticket is still `new` should be implemented later through a controlled backend endpoint or RPC that restricts writable columns. Profile role and tenant changes are admin-only to prevent privilege escalation.

## Applying later

When the Supabase project is linked and reviewed, apply with the Supabase CLI or paste through the SQL editor according to the team's deployment process. This implementation intentionally did not run any remote apply command.
