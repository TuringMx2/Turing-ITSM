-- Turing ITSM initial Supabase/Postgres schema.
-- Authoritative, forward-looking baseline. Defines the complete final model from
-- scratch: multi-tenant tickets, reporters (reporter/channel model), anonymous
-- token-based ticket access, and role-based access control (support_agent/admin).
--
-- This is a create-first initial migration: tables are defined in their final
-- shape (no ALTER/DROP rebuild gymnastics). `create table if not exists`,
-- guarded enums and guarded policies keep it repeatable on a fresh database and
-- safe to re-run locally.
--
-- FK ordering note: `reporters` and `channels` are created before `tickets`
-- because tickets reference reporters (and ticket_sources references channels).

create extension if not exists "pgcrypto";

-- Enum types -----------------------------------------------------------------
-- app_role carries ONLY internal roles. Consumer/customer roles are gone; end-user
-- access is modeled through the reporters table and anonymous access tokens.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('support_agent', 'admin');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_priority') then
    create type public.ticket_priority as enum ('low', 'moderate', 'high', 'urgent');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'new',
      'assigned',
      'in_progress',
      'waiting_customer',
      'waiting_internal',
      'escalated',
      'resolved',
      'closed',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'comment_visibility') then
    create type public.comment_visibility as enum ('public', 'internal');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'attachment_visibility') then
    create type public.attachment_visibility as enum ('public', 'internal');
  end if;
end $$;

-- Tables --------------------------------------------------------------------------------

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_status_check check (status in ('active', 'inactive')),
  constraint tenants_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid null references public.tenants(id) on delete restrict,
  role public.app_role not null,
  full_name text not null,
  email text not null,
  department text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_check check (position('@' in email) > 1)
  -- A profile may be "unprovisioned" (tenant_id IS NULL) until an admin assigns a
  -- tenant. While unprovisioned, current_tenant_id() returns NULL and RLS blocks its
  -- access, so it stays inert until provisioned via the admin-only provision_profile RPC.
);

create table if not exists public.permissions (
  key text primary key,
  description text not null
);

create table if not exists public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

-- reporters: entities that originate/participate in a ticket without necessarily being
-- an authenticated profile. Created before tickets to satisfy the FK below.
create table if not exists public.reporters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  profile_id uuid null references public.profiles(id) on delete set null,
  name text null,
  email text null,
  phone text null,
  company_name text null,
  department text null,
  preferred_contact text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporters_contact_check check (email is not null or phone is not null)
);

-- channels: the ingress channel a ticket source arrived through.
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active bool not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- A ticket is created by EITHER an authenticated user OR a reporter; must have
  -- exactly one of them (tickets_has_creator). The legacy free-text
  -- submitter_name/company_name/department columns are gone, moved to reporters.
  created_by_user_id uuid null references public.profiles(id) on delete set null,
  reporter_id uuid null references public.reporters(id) on delete set null,
  subject text not null,
  priority public.ticket_priority not null,
  description text not null,
  status public.ticket_status not null default 'new',
  assigned_agent_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  closed_at timestamptz null,
  constraint tickets_subject_length_check check (char_length(subject) between 3 and 180),
  constraint tickets_description_length_check check (char_length(description) >= 10),
  constraint tickets_has_creator check (created_by_user_id is not null or reporter_id is not null)
);

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- A comment is authored by EITHER an authenticated user OR a reporter
  -- (ticket_comments_has_author).
  author_user_id uuid null references public.profiles(id) on delete set null,
  reporter_id uuid null references public.reporters(id) on delete set null,
  visibility public.comment_visibility not null default 'public',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_comments_body_length_check check (char_length(body) >= 1),
  constraint ticket_comments_has_author check (author_user_id is not null or reporter_id is not null)
);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- a file is uploaded by either an authenticated user OR a reporter
  -- (ticket_attachments_has_uploader).
  uploaded_by_user_id uuid null references public.profiles(id) on delete set null,
  reporter_id uuid null references public.reporters(id) on delete set null,
  visibility public.attachment_visibility not null default 'public',
  bucket text not null default 'ticket-attachments',
  -- storage_path is the object key within the bucket; globally unique.
  storage_path text not null unique,
  file_name text not null,
  mime_type text null,
  size_bytes bigint null,
  created_at timestamptz not null default now(),
  constraint ticket_attachments_bucket_check check (bucket = 'ticket-attachments'),
  constraint ticket_attachments_size_check check (size_bytes is null or size_bytes >= 0),
  constraint ticket_attachments_has_uploader check (uploaded_by_user_id is not null or reporter_id is not null)
);

-- ticket_sources and ticket_access_tokens depend on tickets/channels.
create table if not exists public.ticket_sources (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete restrict,
  external_thread_id text null,
  payload jsonb null,
  created_at timestamptz not null default now(),
  -- One source per ticket; single-sourced tickets only.
  constraint ticket_sources_ticket_uniq unique (ticket_id)
);

create table if not exists public.ticket_access_tokens (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  -- Optional reporter identity allowed to RESPOND through this token. View-only
  -- tokens can leave this null; respond tokens MUST point at a reporter so the
  -- resulting comment can be attributed. The reporter is immutable per row.
  reporter_id uuid null references public.reporters(id) on delete set null,
  -- token_hash: SHA-256 of the raw token; the plain token is never stored.
  token_hash text not null unique,
  purpose text not null default 'view' check (purpose in ('view', 'respond')),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete restrict,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  actor_role public.app_role null,
  action text not null,
  resource_type text not null,
  resource_id uuid null,
  old_value jsonb null,
  new_value jsonb null,
  ip_address inet null,
  user_agent text null,
  created_at timestamptz not null default now()
);

-- Seeds --------------------------------------------------------------------------------

-- Permissions catalog. Covers the full supported surface, including keys a future
-- owner-facing experience may consume (ticket:update:own, dashboard:read:customer,
-- etc.) even though the current app_role enum only pins support_agent/admin rows.
insert into public.permissions (key, description) values
  ('ticket:create', 'Create tickets'),
  ('ticket:read:own', 'Read own tickets'),
  ('ticket:read:tenant', 'Read tenant tickets'),
  ('ticket:read:all', 'Read all tickets'),
  ('ticket:update:own', 'Update own tickets'),
  ('ticket:update:tenant', 'Update tenant tickets'),
  ('ticket:update:all', 'Update all tickets'),
  ('ticket:change_status', 'Change ticket status'),
  ('ticket:assign', 'Assign tickets'),
  ('ticket:reassign', 'Reassign tickets'),
  ('ticket:escalate', 'Escalate tickets'),
  ('ticket:close', 'Close tickets'),
  ('ticket:reopen', 'Reopen tickets'),
  ('ticket:delete', 'Delete tickets with restrictions'),
  ('comment:create:public', 'Create public comments'),
  ('comment:create:internal', 'Create internal notes'),
  ('comment:read:public', 'Read public comments'),
  ('comment:read:internal', 'Read internal notes'),
  ('attachment:create', 'Create attachments'),
  ('attachment:read', 'Read attachments'),
  ('dashboard:read:customer', 'Read customer dashboard'),
  ('dashboard:read:agent', 'Read support dashboard'),
  ('dashboard:read:admin', 'Read admin dashboard'),
  ('tenant:read', 'Read tenants'),
  ('tenant:create', 'Create tenants'),
  ('tenant:update', 'Update tenants'),
  ('tenant:disable', 'Disable tenants'),
  ('user:read', 'Read users'),
  ('user:create', 'Create users'),
  ('user:update', 'Update users'),
  ('user:disable', 'Disable users'),
  ('user:assign_role', 'Assign roles'),
  ('category:read', 'Read categories'),
  ('category:create', 'Create categories'),
  ('category:update', 'Update categories'),
  ('category:disable', 'Disable categories'),
  ('sla:read', 'Read SLA'),
  ('sla:create', 'Create SLA'),
  ('sla:update', 'Update SLA'),
  ('sla:disable', 'Disable SLA'),
  ('asset:read', 'Read assets'),
  ('asset:create', 'Create assets'),
  ('asset:update', 'Update assets'),
  ('asset:disable', 'Disable assets'),
  ('asset:link_ticket', 'Link assets to tickets'),
  ('audit:read:ticket', 'Read ticket audit'),
  ('audit:read:global', 'Read global audit'),
  ('audit:export', 'Export audit')
on conflict (key) do update set description = excluded.description;

-- Role -> permission mappings for the internal roles ONLY.
-- No customer_user / customer_manager rows: those roles no longer exist.
insert into public.role_permissions (role, permission_key) values
  ('support_agent', 'ticket:create'),
  ('support_agent', 'ticket:read:all'),
  ('support_agent', 'ticket:update:all'),
  ('support_agent', 'ticket:change_status'),
  ('support_agent', 'ticket:assign'),
  ('support_agent', 'ticket:reassign'),
  ('support_agent', 'ticket:escalate'),
  ('support_agent', 'ticket:close'),
  ('support_agent', 'ticket:reopen'),
  ('support_agent', 'comment:create:public'),
  ('support_agent', 'comment:create:internal'),
  ('support_agent', 'comment:read:public'),
  ('support_agent', 'comment:read:internal'),
  ('support_agent', 'attachment:create'),
  ('support_agent', 'attachment:read'),
  ('support_agent', 'dashboard:read:agent'),
  ('support_agent', 'sla:read'),
  ('support_agent', 'asset:read'),
  ('support_agent', 'asset:link_ticket'),
  ('support_agent', 'audit:read:ticket'),
  ('admin', 'ticket:create'),
  ('admin', 'ticket:read:all'),
  ('admin', 'ticket:update:all'),
  ('admin', 'ticket:change_status'),
  ('admin', 'ticket:assign'),
  ('admin', 'ticket:reassign'),
  ('admin', 'ticket:escalate'),
  ('admin', 'ticket:close'),
  ('admin', 'ticket:reopen'),
  ('admin', 'ticket:delete'),
  ('admin', 'comment:create:public'),
  ('admin', 'comment:create:internal'),
  ('admin', 'comment:read:public'),
  ('admin', 'comment:read:internal'),
  ('admin', 'attachment:create'),
  ('admin', 'attachment:read'),
  ('admin', 'dashboard:read:agent'),
  ('admin', 'dashboard:read:admin'),
  ('admin', 'tenant:read'),
  ('admin', 'tenant:create'),
  ('admin', 'tenant:update'),
  ('admin', 'tenant:disable'),
  ('admin', 'user:read'),
  ('admin', 'user:create'),
  ('admin', 'user:update'),
  ('admin', 'user:disable'),
  ('admin', 'user:assign_role'),
  ('admin', 'category:read'),
  ('admin', 'category:create'),
  ('admin', 'category:update'),
  ('admin', 'category:disable'),
  ('admin', 'sla:read'),
  ('admin', 'sla:create'),
  ('admin', 'sla:update'),
  ('admin', 'sla:disable'),
  ('admin', 'asset:read'),
  ('admin', 'asset:create'),
  ('admin', 'asset:update'),
  ('admin', 'asset:disable'),
  ('admin', 'asset:link_ticket'),
  ('admin', 'audit:read:ticket'),
  ('admin', 'audit:read:global'),
  ('admin', 'audit:export')
on conflict (role, permission_key) do nothing;

-- Seed the channel catalog. Idempotent on the unique code column.
insert into public.channels (code, label) values
  ('embedded_chat', 'Embedded chat'),
  ('web_form', 'Web form'),
  ('whatsapp', 'WhatsApp'),
  ('api', 'API')
on conflict (code) do nothing;

-- Triggers and helper functions -----------------------------------------------------------

-- Keeps updated_at in sync on write paths. Nothing here auto-provisions on signup:
-- no handle_new_user trigger (removed). Profiles are provisioned explicitly via the
-- admin-only provision_profile RPC.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assert_ticket_comment_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.tickets
    where tickets.id = new.ticket_id
      and tickets.tenant_id = new.tenant_id
  ) then
    raise exception 'ticket_comments.tenant_id must match tickets.tenant_id';
  end if;
  return new;
end;
$$;

create or replace function public.assert_ticket_attachment_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.tickets
    where tickets.id = new.ticket_id
      and tickets.tenant_id = new.tenant_id
  ) then
    raise exception 'ticket_attachments.tenant_id must match tickets.tenant_id';
  end if;
  return new;
end;
$$;

-- Author attribution is immutable on a comment: neither the authenticated author nor
-- the reporter scope may be swapped on update.
create or replace function public.prevent_ticket_comment_author_change()
returns trigger
language plpgsql
as $$
begin
  if new.author_user_id is distinct from old.author_user_id
     or new.reporter_id is distinct from old.reporter_id
  then
    raise exception 'ticket_comments authorship cannot be changed';
  end if;
  return new;
end;
$$;

create or replace trigger set_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create or replace trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace trigger set_tickets_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

-- Sequence-backed, human-friendly ticket numbers ({tenant_prefix}-{padded_seq}).
-- A per-tenant prefix (tenants.slug, uppercased, truncated to 6 chars) keeps numbers
-- readable and unique within a tenant, while the global sequence guarantees a monotonic
-- value. Kept as a fallback-safe column so a service layer can still set it explicitly.
create sequence if not exists public.ticket_number_seq;
create or replace function public.assign_ticket_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_prefix text;
begin
  if new.ticket_number is null then
    select upper(substr(md5(coalesce(nullif(slug, ''), 'TT')), 1, 6))
      into v_prefix
      from public.tenants
      where id = new.tenant_id;

    if v_prefix is null then
      v_prefix := 'TT0000';
    end if;

    new.ticket_number := v_prefix || '-' || lpad(nextval('public.ticket_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
create or replace trigger assign_tickets_number
before insert on public.tickets
for each row execute function public.assign_ticket_number();

create or replace trigger set_ticket_comments_updated_at
before update on public.ticket_comments
for each row execute function public.set_updated_at();

create or replace trigger prevent_ticket_comments_author_change
before update on public.ticket_comments
for each row execute function public.prevent_ticket_comment_author_change();

create or replace trigger assert_ticket_comments_tenant
before insert or update on public.ticket_comments
for each row execute function public.assert_ticket_comment_tenant();

create or replace trigger assert_ticket_attachments_tenant
before insert or update on public.ticket_attachments
for each row execute function public.assert_ticket_attachment_tenant();

-- RLS helper functions use SECURITY DEFINER to avoid recursive profile policy reads.
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('support_agent', 'admin'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

-- Ticket reads are restricted to internal roles only. Non-internal roles have no
-- direct full-tenant ticket visibility here; consumer access flows through the
-- reporters model and the token-based resolve_ticket_access RPC.
create or replace function public.can_read_ticket(ticket_row public.tickets)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_internal_user(), false)
$$;

create or replace function public.can_read_ticket_id(target_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_read_ticket(tickets)
    from public.tickets
    where tickets.id = target_ticket_id
  ), false)
$$;

-- Revoke the SECURITY DEFINER helpers from PUBLIC and anon, then grant EXECUTE back
-- to authenticated ONLY. This keeps anon away from privileged lookups while still
-- letting RLS policies call them as the authenticated session role (PostgreSQL enforces
-- EXECUTE on functions referenced inside RLS expressions). For the two RPC entrypoints
-- below, the grants are narrower (see their sections).
revoke execute on function public.current_role() from public, anon;
revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.is_internal_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_read_ticket(public.tickets) from public, anon;
revoke execute on function public.can_read_ticket_id(uuid) from public, anon;

grant execute on function public.current_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_internal_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_read_ticket(public.tickets) to authenticated;
grant execute on function public.can_read_ticket_id(uuid) to authenticated;

-- Anonymous, token-based access to a SINGLE ticket plus its PUBLIC comments.
-- Internal notes are never returned. SECURITY DEFINER so the function bypasses RLS on
-- tickets/ticket_comments; callers prove access by presenting the RAW token, which is
-- hashed inside the function and compared to the stored hash. The raw token is
-- therefore safe to pass in a magic link and is never persisted.
-- Only expires_at/revoked_at/visibility gates live inside the query.
create or replace function public.resolve_ticket_access(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'ticket_id', tgt.id,
    'ticket_number', tgt.ticket_number,
    'status', tgt.status,
    'subject', tgt.subject,
    'description', tgt.description,
    'created_at', tgt.created_at,
    'comments',
      coalesce(
        (
          select jsonb_agg(c)
          from public.ticket_comments c
          where c.ticket_id = tgt.id
            and c.visibility = 'public'
        ),
        '[]'::jsonb
      )
  ) into v
  from public.ticket_access_tokens tok
  join public.tickets tgt on tgt.id = tok.ticket_id
  where tok.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and (tok.expires_at is null or tok.expires_at > now())
    and tok.revoked_at is null;

  return coalesce(v, '{}'::jsonb);
end;
$$;

-- Grant EXECUTE to anon (so anonymous link-based viewers can call) and authenticated.
revoke execute on function public.resolve_ticket_access(text) from public;
grant execute on function public.resolve_ticket_access(text) to anon, authenticated, service_role;

-- Reporter reply through a magic link. Validates a 'respond' token, then inserts a
-- PUBLIC comment attributed to the token's reporter. Never returns internal notes.
-- SECURITY DEFINER: callers prove access with a valid token; no RLS bypass beyond the
-- single-ticket scope guaranteed by the token lookup.
create or replace function public.add_ticket_public_comment_by_token(p_token text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_tenant_id uuid;
  v_reporter_id uuid;
  v_comment jsonb;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'add_ticket_public_comment_by_token.body_required';
  end if;

  select tgt.id, tgt.tenant_id, tok.reporter_id
    into v_ticket_id, v_tenant_id, v_reporter_id
  from public.ticket_access_tokens tok
  join public.tickets tgt on tgt.id = tok.ticket_id
  where tok.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and tok.purpose = 'respond'
    and (tok.expires_at is null or tok.expires_at > now())
    and tok.revoked_at is null;

  if not found then
    raise exception 'add_ticket_public_comment_by_token.invalid_or_expired_token';
  end if;

  if v_reporter_id is null then
    raise exception 'add_ticket_public_comment_by_token.respond_token_missing_reporter';
  end if;

  insert into public.ticket_comments (ticket_id, tenant_id, reporter_id, visibility, body)
  values (v_ticket_id, v_tenant_id, v_reporter_id, 'public', p_body)
  returning to_jsonb(ticket_comments) into v_comment;

  return v_comment;
end;
$$;

revoke execute on function public.add_ticket_public_comment_by_token(text, text) from public;
grant execute on function public.add_ticket_public_comment_by_token(text, text) to anon, authenticated, service_role;

-- Server/admin token minting. Generates an access token row from a RAW token supplied by
-- the caller (backend service or admin console). Only service_role or an authenticated
-- admin may mint: the is_admin() guard blocks any non-privileged authenticated user, and
-- the function is never granted to anon. 'respond' tokens MUST carry a reporter_id.
create or replace function public.create_ticket_access_token(
  p_ticket_id uuid,
  p_purpose text,
  p_raw_token text,
  p_expires_at timestamptz,
  p_reporter_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'create_ticket_access_token.denied: caller is not admin';
  end if;

  if p_purpose not in ('view', 'respond') then
    raise exception 'create_ticket_access_token.invalid_purpose';
  end if;

  if p_purpose = 'respond' and p_reporter_id is null then
    raise exception 'create_ticket_access_token.respond_requires_reporter';
  end if;

  if p_raw_token is null or char_length(p_raw_token) < 16 then
    raise exception 'create_ticket_access_token.token_too_short';
  end if;

  insert into public.ticket_access_tokens (ticket_id, reporter_id, token_hash, purpose, expires_at)
  values (p_ticket_id, p_reporter_id, encode(digest(p_raw_token, 'sha256'), 'hex'), p_purpose, p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

-- service_role + authenticated (gated by is_admin() inside); anon is NEVER granted this.
revoke execute on function public.create_ticket_access_token(uuid, text, text, timestamptz, uuid) from public;
grant execute on function public.create_ticket_access_token(uuid, text, text, timestamptz, uuid) to authenticated, service_role;

-- Admin-only profile provisioning RPC. SECURITY DEFINER so it can write profiles while
-- escaping RLS; the caller is pinned to an admin BEFORE any write via public.is_admin()
-- (which itself gates on the authenticated id inside the SECURITY DEFINER/RLS context).
--
-- No role is EVER auto-assigned: provisioning requires an is_admin() caller, so this
-- cannot be abused to self-escalate to a privileged role. service_role is NOT granted
-- here by design; add an explicit grant only if a server-side onboarding flow needs it.
create or replace function public.provision_profile(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid,
  p_full_name text,
  p_email text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'provision_profile.denied: caller is not admin';
  end if;

  insert into public.profiles (id, tenant_id, role, full_name, email)
  values (p_user_id, p_tenant_id, p_role, p_full_name, p_email)
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    role = excluded.role,
    full_name = excluded.full_name,
    email = excluded.email;
end;
$$;

-- EXECUTE to authenticated only (NOT anon). The is_admin() guard inside the body is
-- what makes the authenticated grant safe.
revoke execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) from public;
grant execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) to authenticated;
-- NOTE: service_role intentionally omitted. Add "grant execute ... to service_role"
-- only if a server-side flow requires it.

-- Indexes --------------------------------------------------------------------------------

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists tickets_tenant_created_at_idx on public.tickets (tenant_id, created_at desc);
create index if not exists tickets_status_priority_idx on public.tickets (status, priority);
create index if not exists tickets_assigned_agent_status_idx on public.tickets (assigned_agent_id, status);
create index if not exists tickets_created_by_created_at_idx on public.tickets (created_by_user_id, created_at desc);
create index if not exists tickets_reporter_idx on public.tickets (reporter_id);
create index if not exists ticket_comments_ticket_created_at_idx on public.ticket_comments (ticket_id, created_at);
create index if not exists ticket_attachments_ticket_created_at_idx on public.ticket_attachments (ticket_id, created_at);
create index if not exists audit_events_tenant_created_at_idx on public.audit_events (tenant_id, created_at desc);
create index if not exists audit_events_resource_idx on public.audit_events (resource_type, resource_id);
create index if not exists audit_events_actor_user_idx on public.audit_events (actor_user_id);
create index if not exists reporters_tenant_idx on public.reporters (tenant_id);
create index if not exists reporters_profile_id_idx on public.reporters (profile_id);
-- A reporter is unique per tenant on contact channel, but only where the value is set.
-- Partial unique indexes keep multiple null email/phone reporters per tenant possible.
create unique index if not exists reporters_tenant_email_uniq on public.reporters (tenant_id, email) where email is not null;
create unique index if not exists reporters_tenant_phone_uniq on public.reporters (tenant_id, phone) where phone is not null;
create index if not exists ticket_access_tokens_ticket_idx on public.ticket_access_tokens (ticket_id);
create index if not exists ticket_access_tokens_reporter_idx on public.ticket_access_tokens (reporter_id);
-- ticket_sources is already covered by its unique (ticket_id) constraint.

-- Row Level Security ---------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.channels enable row level security;
alter table public.reporters enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_sources enable row level security;
alter table public.ticket_access_tokens enable row level security;
alter table public.audit_events enable row level security;

-- Policy creation guarded for repeatable local development.
-- ticket_sources and ticket_access_tokens intentionally have NO policies: direct access
-- is denied for every role and only SECURITY DEFINER helpers may read them.
do $$
begin
  -- tenants
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_select_by_scope') then
    create policy tenants_select_by_scope on public.tenants
      for select to authenticated
      using (public.is_internal_user() or id = public.current_tenant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_admin_write') then
    create policy tenants_admin_write on public.tenants
      for all to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  -- profiles
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_by_scope') then
    create policy profiles_select_by_scope on public.profiles
      for select to authenticated
      using (
        id = auth.uid()
        or public.is_admin()
        or (public.current_role() = 'support_agent' and id in (
          select created_by_user_id from public.tickets where public.can_read_ticket(tickets)
          union
          select assigned_agent_id from public.tickets
          where assigned_agent_id is not null and public.can_read_ticket(tickets)
        ))
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_update') then
    create policy profiles_admin_update on public.profiles
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_insert') then
    create policy profiles_admin_insert on public.profiles
      for insert to authenticated
      with check (public.is_admin());
  end if;

  -- permissions / role_permissions
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'permissions' and policyname = 'permissions_select_authenticated') then
    create policy permissions_select_authenticated on public.permissions
      for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and policyname = 'role_permissions_select_authenticated') then
    create policy role_permissions_select_authenticated on public.role_permissions
      for select to authenticated
      using (true);
  end if;

  -- tickets
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_select_by_role_scope') then
    create policy tickets_select_by_role_scope on public.tickets
      for select to authenticated
      using (public.can_read_ticket(tickets));
  end if;

  -- Ticket creation is reserved for internal roles via the service/platform flows.
  -- End-user-facing anonymous tickets are created through the channels API (service
  -- side, governance by reporter source), NOT by end users writing tickets directly.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_insert_by_role_scope') then
    create policy tickets_insert_by_role_scope on public.tickets
      for insert to authenticated
      with check (
        public.current_role() in ('support_agent', 'admin')
        and status = 'new'
        and assigned_agent_id is null
        and created_by_user_id = auth.uid()
        and reporter_id is null
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_update_by_internal_roles') then
    create policy tickets_update_by_internal_roles on public.tickets
      for update to authenticated
      using (public.current_role() in ('support_agent', 'admin'))
      with check (public.current_role() in ('support_agent', 'admin'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_admin_delete') then
    create policy tickets_admin_delete on public.tickets
      for delete to authenticated
      using (public.is_admin());
  end if;

  -- ticket_comments
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_comments' and policyname = 'ticket_comments_select_by_visibility') then
    create policy ticket_comments_select_by_visibility on public.ticket_comments
      for select to authenticated
      using (
        public.can_read_ticket_id(ticket_id)
        and (visibility = 'public' or public.is_internal_user())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_comments' and policyname = 'ticket_comments_insert_by_visibility') then
    create policy ticket_comments_insert_by_visibility on public.ticket_comments
      for insert to authenticated
      with check (
        public.can_read_ticket_id(ticket_id)
        and author_user_id = auth.uid()
        and tenant_id = (select tickets.tenant_id from public.tickets where tickets.id = ticket_id)
        and (visibility = 'public' or public.is_internal_user())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_comments' and policyname = 'ticket_comments_update_own_or_internal') then
    create policy ticket_comments_update_own_or_internal on public.ticket_comments
      for update to authenticated
      using (author_user_id = auth.uid() or public.is_internal_user())
      with check (
        public.can_read_ticket_id(ticket_id)
        and ticket_id = old.ticket_id
        and tenant_id = old.tenant_id
        and author_user_id = old.author_user_id
        and reporter_id = old.reporter_id
        and (author_user_id = auth.uid() or public.is_admin())
        and (visibility = old.visibility or public.is_internal_user())
      );
  end if;

  -- No DELETE policy: comments are immutable once their authorship is inserted.
  -- Deletion only happens through privileged/service-side flows that act as the table
  -- owner, not through the client API.

  -- ticket_attachments
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_attachments' and policyname = 'ticket_attachments_select_by_visibility') then
    create policy ticket_attachments_select_by_visibility on public.ticket_attachments
      for select to authenticated
      using (
        public.can_read_ticket_id(ticket_id)
        and (visibility = 'public' or public.is_internal_user())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_attachments' and policyname = 'ticket_attachments_insert_by_visibility') then
    create policy ticket_attachments_insert_by_visibility on public.ticket_attachments
      for insert to authenticated
      with check (
        public.can_read_ticket_id(ticket_id)
        and uploaded_by_user_id = auth.uid()
        and tenant_id = (select tickets.tenant_id from public.tickets where tickets.id = ticket_id)
        and bucket = 'ticket-attachments'
        and (visibility = 'public' or public.is_internal_user())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ticket_attachments' and policyname = 'ticket_attachments_delete_own_or_admin') then
    create policy ticket_attachments_delete_own_or_admin on public.ticket_attachments
      for delete to authenticated
      using (uploaded_by_user_id = auth.uid() or public.is_admin());
  end if;

  -- audit_events
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_events' and policyname = 'audit_events_select_by_scope') then
    create policy audit_events_select_by_scope on public.audit_events
      for select to authenticated
      using (
        public.is_admin()
        or (
          resource_type = 'ticket'
          and resource_id is not null
          and public.can_read_ticket_id(resource_id)
          and (
            public.is_internal_user()
            or action not in ('note_internal_created', 'internal_attachment_added')
          )
        )
      );
  end if;

  -- channels: internal roles only.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'channels' and policyname = 'channels_select_internal') then
    create policy channels_select_internal on public.channels
      for select to authenticated
      using (public.is_internal_user() or public.is_admin());
  end if;

  -- reporters: visible/manageable by internal roles only.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reporters' and policyname = 'reporters_select_internal') then
    create policy reporters_select_internal on public.reporters
      for select to authenticated
      using (public.is_internal_user() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reporters' and policyname = 'reporters_write_internal') then
    create policy reporters_write_internal on public.reporters
      for all to authenticated
      using (public.is_internal_user() or public.is_admin())
      with check (public.is_internal_user() or public.is_admin());
  end if;
end $$;

-- Storage ---------------------------------------------------------------------------------
-- Private bucket holding ticket attachment blobs. The bucket is NOT public; objects are
-- served through short-lived signed URLs generated server-side after checking ticket +
-- attachment visibility. RLS below gates direct API reads/uploads; service_role (backend)
-- manages objects and generates signed URLs.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-attachments', 'ticket-attachments', false, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

alter table storage.objects enable row level security;

do $$
begin
  -- Internal authenticated users may read blobs for tickets they can read. Attachment
  -- metadata + visibility live in public.ticket_attachments; storage_path is the object key.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ticket_attachments_read_by_ticket_access') then
    create policy ticket_attachments_read_by_ticket_access on storage.objects
      for select to authenticated
      using (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1
          from public.ticket_attachments att
          where att.storage_path = storage.objects.name
            and (att.visibility = 'public' or public.is_internal_user())
            and public.can_read_ticket_id(att.ticket_id)
        )
      );
  end if;

  -- Uploads create the metadata row first (insert policy on public.ticket_attachments),
  -- then the blob; both require ticket read access.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ticket_attachments_upload') then
    create policy ticket_attachments_upload on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1
          from public.ticket_attachments att
          where att.storage_path = storage.objects.name
            and att.uploaded_by_user_id = auth.uid()
            and public.can_read_ticket_id(att.ticket_id)
        )
      );
  end if;

  -- Delete: own uploads or admin. Metadata rows and blobs are removed together by the
  -- service layer; the blob policy mirrors the metadata delete policy.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ticket_attachments_delete_own_or_admin') then
    create policy ticket_attachments_delete_own_or_admin on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'ticket-attachments'
        and exists (
          select 1
          from public.ticket_attachments att
          where att.storage_path = storage.objects.name
            and (att.uploaded_by_user_id = auth.uid() or public.is_admin())
        )
      );
  end if;
end $$;