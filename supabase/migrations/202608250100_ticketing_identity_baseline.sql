-- Ticketing and identity baseline for a fresh application schema.
-- Customer-facing roles remain available while the current internal stage uses
-- support_agent and admin. Profiles are provisioned explicitly; no signup trigger
-- assigns a role.

create extension if not exists "pgcrypto";
create schema if not exists private;
create type public.app_role as enum (
  'customer_user',
  'customer_manager',
  'support_agent',
  'admin'
);
create type public.ticket_priority as enum ('low', 'moderate', 'high', 'urgent');
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
create type public.comment_visibility as enum ('public', 'internal');
create type public.attachment_visibility as enum ('public', 'internal');
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_status_check check (status in ('active', 'inactive')),
  constraint tenants_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_name_check check (char_length(btrim(name)) between 2 and 160)
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  role public.app_role not null,
  full_name text not null,
  email text not null,
  department text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_check check (position('@' in email) > 1),
  constraint profiles_name_check check (char_length(btrim(full_name)) between 1 and 160),
  constraint profiles_customer_tenant_check check (
    role not in ('customer_user', 'customer_manager') or tenant_id is not null
  ),
  unique (tenant_id, id)
);
create table public.permissions (
  key text primary key,
  description text not null
);
create table public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);
create table public.reporters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  profile_id uuid,
  name text,
  email text,
  phone text,
  company_name text,
  department text,
  preferred_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporters_contact_check check (email is not null or phone is not null),
  constraint reporters_profile_tenant_fk
    foreign key (tenant_id, profile_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id)
);
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create sequence public.ticket_number_seq;
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by_user_id uuid,
  reporter_id uuid,
  subject text not null,
  priority public.ticket_priority not null,
  description text not null,
  status public.ticket_status not null default 'new',
  assigned_agent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  constraint tickets_subject_length_check check (char_length(btrim(subject)) between 3 and 180),
  constraint tickets_description_length_check check (char_length(btrim(description)) between 10 and 8000),
  constraint tickets_has_creator_check check (
    created_by_user_id is not null or reporter_id is not null
  ),
  constraint tickets_reporter_tenant_fk
    foreign key (tenant_id, reporter_id)
    references public.reporters (tenant_id, id)
    on delete restrict,
  constraint tickets_creator_tenant_fk
    foreign key (tenant_id, created_by_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint tickets_assigned_agent_tenant_fk
    foreign key (tenant_id, assigned_agent_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id)
);
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  tenant_id uuid not null,
  author_user_id uuid,
  reporter_id uuid,
  visibility public.comment_visibility not null default 'public',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_comments_body_length_check check (char_length(btrim(body)) between 1 and 8000),
  constraint ticket_comments_has_author_check check (
    author_user_id is not null or reporter_id is not null
  ),
  constraint ticket_comments_ticket_tenant_fk
    foreign key (tenant_id, ticket_id)
    references public.tickets (tenant_id, id)
    on delete cascade,
  constraint ticket_comments_reporter_tenant_fk
    foreign key (tenant_id, reporter_id)
    references public.reporters (tenant_id, id)
    on delete restrict,
  constraint ticket_comments_author_tenant_fk
    foreign key (tenant_id, author_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id)
);
create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  tenant_id uuid not null,
  uploaded_by_user_id uuid,
  reporter_id uuid,
  visibility public.attachment_visibility not null default 'public',
  bucket text not null default 'ticket-attachments',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint ticket_attachments_bucket_check check (bucket = 'ticket-attachments'),
  constraint ticket_attachments_size_check check (size_bytes is null or size_bytes >= 0),
  constraint ticket_attachments_has_uploader_check check (
    uploaded_by_user_id is not null or reporter_id is not null
  ),
  constraint ticket_attachments_ticket_tenant_fk
    foreign key (tenant_id, ticket_id)
    references public.tickets (tenant_id, id)
    on delete cascade,
  constraint ticket_attachments_reporter_tenant_fk
    foreign key (tenant_id, reporter_id)
    references public.reporters (tenant_id, id)
    on delete restrict,
  constraint ticket_attachments_uploader_tenant_fk
    foreign key (tenant_id, uploaded_by_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id)
);
create table public.ticket_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  channel_id uuid not null references public.channels(id) on delete restrict,
  external_thread_id text,
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint ticket_sources_ticket_tenant_fk
    foreign key (tenant_id, ticket_id)
    references public.tickets (tenant_id, id)
    on delete cascade,
  unique (ticket_id)
);
create table public.ticket_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  reporter_id uuid,
  token_hash text not null unique,
  purpose text not null default 'view',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ticket_access_tokens_purpose_check check (purpose in ('view', 'respond')),
  constraint ticket_access_tokens_respond_reporter_check check (
    purpose <> 'respond' or reporter_id is not null
  ),
  constraint ticket_access_tokens_ticket_tenant_fk
    foreign key (tenant_id, ticket_id)
    references public.tickets (tenant_id, id)
    on delete cascade,
  constraint ticket_access_tokens_reporter_tenant_fk
    foreign key (tenant_id, reporter_id)
    references public.reporters (tenant_id, id)
    on delete restrict
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  actor_user_id uuid,
  actor_role public.app_role,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_tenant_check check (
    actor_user_id is null or tenant_id is not null
  ),
  constraint audit_events_actor_tenant_fk
    foreign key (tenant_id, actor_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict
);
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
  ('audit:export', 'Export audit');
insert into public.role_permissions (role, permission_key)
select role_name::public.app_role, permission_key
from (values
  ('customer_user', 'ticket:create'),
  ('customer_user', 'ticket:read:own'),
  ('customer_user', 'ticket:update:own'),
  ('customer_user', 'ticket:reopen'),
  ('customer_user', 'comment:create:public'),
  ('customer_user', 'comment:read:public'),
  ('customer_user', 'attachment:create'),
  ('customer_user', 'attachment:read'),
  ('customer_user', 'dashboard:read:customer'),
  ('customer_user', 'category:read'),
  ('customer_user', 'asset:read'),
  ('customer_user', 'audit:read:ticket'),
  ('customer_manager', 'ticket:create'),
  ('customer_manager', 'ticket:read:own'),
  ('customer_manager', 'ticket:read:tenant'),
  ('customer_manager', 'ticket:update:own'),
  ('customer_manager', 'ticket:update:tenant'),
  ('customer_manager', 'ticket:reopen'),
  ('customer_manager', 'comment:create:public'),
  ('customer_manager', 'comment:read:public'),
  ('customer_manager', 'attachment:create'),
  ('customer_manager', 'attachment:read'),
  ('customer_manager', 'dashboard:read:customer'),
  ('customer_manager', 'category:read'),
  ('customer_manager', 'user:read'),
  ('customer_manager', 'asset:read'),
  ('customer_manager', 'audit:read:ticket'),
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
) as grants(role_name, permission_key);
insert into public.channels (code, label) values
  ('embedded_chat', 'Embedded chat'),
  ('web_form', 'Web form'),
  ('whatsapp', 'WhatsApp'),
  ('api', 'API');
create function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
create function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id from public.profiles p where p.id = (select auth.uid())
$$;
create function private.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_tenant_id is not null
    and private.current_role() = 'admin'
    and private.current_tenant_id() = p_tenant_id,
    false
  )
$$;
create function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_role() in ('support_agent', 'admin')
    and private.current_tenant_id() is not null,
    false
  )
$$;
create function private.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case private.current_role()
      when 'customer_user' then
        t.tenant_id = private.current_tenant_id()
        and (
          t.created_by_user_id = (select auth.uid())
          or exists (
            select 1 from public.reporters r
            where r.id = t.reporter_id and r.profile_id = (select auth.uid())
          )
        )
      when 'customer_manager' then t.tenant_id = private.current_tenant_id()
      when 'support_agent' then t.tenant_id = private.current_tenant_id()
      when 'admin' then t.tenant_id = private.current_tenant_id()
      else false
    end
    from public.tickets t
    where t.id = p_ticket_id
  ), false)
$$;
alter function private.current_role() owner to postgres;
alter function private.current_tenant_id() owner to postgres;
alter function private.is_tenant_admin(uuid) owner to postgres;
alter function private.is_internal_user() owner to postgres;
alter function private.can_read_ticket(uuid) owner to postgres;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke execute on function private.current_role() from public;
revoke execute on function private.current_tenant_id() from public;
revoke execute on function private.is_tenant_admin(uuid) from public;
revoke execute on function private.is_internal_user() from public;
revoke execute on function private.can_read_ticket(uuid) from public;
grant execute on function private.current_role() to authenticated;
grant execute on function private.current_tenant_id() to authenticated;
grant execute on function private.is_tenant_admin(uuid) to authenticated;
grant execute on function private.is_internal_user() to authenticated;
grant execute on function private.can_read_ticket(uuid) to authenticated;
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create function private.prepare_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
  v_creator_role public.app_role;
  v_creator_tenant uuid;
  v_agent_role public.app_role;
begin
  if new.ticket_number is null or btrim(new.ticket_number) = '' then
    select upper(substr(md5(coalesce(nullif(t.slug, ''), 'TT')), 1, 6))
      into v_prefix
    from public.tenants t
    where t.id = new.tenant_id;

    new.ticket_number := coalesce(v_prefix, 'TT0000')
      || '-'
      || lpad(nextval('public.ticket_number_seq')::text, 6, '0');
  end if;

  if new.created_by_user_id is not null then
    select p.role, p.tenant_id into v_creator_role, v_creator_tenant
    from public.profiles p where p.id = new.created_by_user_id;

    if v_creator_role in ('customer_user', 'customer_manager')
       and v_creator_tenant is distinct from new.tenant_id then
      raise exception 'tickets.created_by_user_id must belong to the ticket tenant';
    end if;
  end if;

  if new.assigned_agent_id is not null then
    select p.role into v_agent_role
    from public.profiles p where p.id = new.assigned_agent_id;

    if v_agent_role not in ('support_agent', 'admin') then
      raise exception 'tickets.assigned_agent_id must reference an internal user';
    end if;
  end if;

  return new;
end;
$$;
create function private.prevent_ticket_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticket_id is distinct from old.ticket_id
     or new.tenant_id is distinct from old.tenant_id
     or new.author_user_id is distinct from old.author_user_id
     or new.reporter_id is distinct from old.reporter_id then
    raise exception 'ticket comment scope and authorship are immutable';
  end if;
  return new;
end;
$$;
create function private.prevent_ticket_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.reporter_id is distinct from old.reporter_id then
    raise exception 'Ticket tenant and origin identity are immutable';
  end if;
  return new;
end;
$$;
create trigger set_tenants_updated_at
before update on public.tenants
for each row execute function private.set_updated_at();
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger set_reporters_updated_at
before update on public.reporters
for each row execute function private.set_updated_at();
create trigger prepare_ticket_before_write
before insert or update on public.tickets
for each row execute function private.prepare_ticket();
create trigger set_tickets_updated_at
before update on public.tickets
for each row execute function private.set_updated_at();
create trigger prevent_ticket_identity_change
before update on public.tickets
for each row execute function private.prevent_ticket_identity_change();
create trigger set_ticket_comments_updated_at
before update on public.ticket_comments
for each row execute function private.set_updated_at();
create trigger prevent_ticket_comments_scope_change
before update on public.ticket_comments
for each row execute function private.prevent_ticket_scope_change();
revoke execute on function private.set_updated_at() from public;
revoke execute on function private.prepare_ticket() from public;
revoke execute on function private.prevent_ticket_scope_change() from public;
revoke execute on function private.prevent_ticket_identity_change() from public;
create function public.resolve_ticket_access(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'ticket_id', t.id,
      'ticket_number', t.ticket_number,
      'status', t.status,
      'subject', t.subject,
      'description', t.description,
      'created_at', t.created_at,
      'comments', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.created_at)
        from public.ticket_comments c
        where c.ticket_id = t.id and c.visibility = 'public'
      ), '[]'::jsonb)
    )
    from public.ticket_access_tokens tok
    join public.tickets t on t.id = tok.ticket_id and t.tenant_id = tok.tenant_id
    where tok.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and (tok.expires_at is null or tok.expires_at > now())
      and tok.revoked_at is null
  ), '{}'::jsonb)
$$;
create function public.add_ticket_public_comment_by_token(p_token text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.ticket_access_tokens%rowtype;
  v_comment public.ticket_comments%rowtype;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'A comment body is required';
  end if;

  select tok.* into v_token
  from public.ticket_access_tokens tok
  where tok.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and tok.purpose = 'respond'
    and tok.reporter_id is not null
    and (tok.expires_at is null or tok.expires_at > now())
    and tok.revoked_at is null;

  if not found then
    raise exception 'The response token is invalid or expired';
  end if;

  insert into public.ticket_comments (
    tenant_id, ticket_id, reporter_id, visibility, body
  ) values (
    v_token.tenant_id, v_token.ticket_id, v_token.reporter_id, 'public', p_body
  ) returning * into v_comment;

  return to_jsonb(v_comment);
end;
$$;
create function public.create_ticket_access_token(
  p_ticket_id uuid,
  p_purpose text,
  p_raw_token text,
  p_expires_at timestamptz,
  p_reporter_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant_id uuid;
begin
  if p_purpose not in ('view', 'respond') then
    raise exception 'The token purpose is invalid';
  end if;

  if p_purpose = 'respond' and p_reporter_id is null then
    raise exception 'A response token requires a reporter';
  end if;

  if p_raw_token is null or char_length(p_raw_token) < 16 then
    raise exception 'The raw token must contain at least 16 characters';
  end if;

  select t.tenant_id into strict v_tenant_id
  from public.tickets t where t.id = p_ticket_id;

  if coalesce(auth.role(), '') <> 'service_role'
     and not private.is_tenant_admin(v_tenant_id) then
    raise exception 'Only a tenant admin or trusted service role may create a ticket access token';
  end if;

  insert into public.ticket_access_tokens (
    tenant_id, ticket_id, reporter_id, token_hash, purpose, expires_at
  ) values (
    v_tenant_id,
    p_ticket_id,
    p_reporter_id,
    encode(extensions.digest(p_raw_token, 'sha256'), 'hex'),
    p_purpose,
    p_expires_at
  ) returning id into v_id;

  return v_id;
end;
$$;
create function public.provision_profile(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid,
  p_full_name text,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_tenant_admin(p_tenant_id) then
    raise exception 'Only an admin for the target tenant may provision profiles';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.tenant_id is distinct from p_tenant_id
  ) then
    raise exception 'A profile cannot be moved between tenants by provisioning';
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
alter function public.resolve_ticket_access(text) owner to postgres;
alter function public.add_ticket_public_comment_by_token(text, text) owner to postgres;
alter function public.create_ticket_access_token(uuid, text, text, timestamptz, uuid) owner to postgres;
alter function public.provision_profile(uuid, public.app_role, uuid, text, text) owner to postgres;
revoke execute on function public.resolve_ticket_access(text) from public, anon, authenticated, service_role;
revoke execute on function public.add_ticket_public_comment_by_token(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.create_ticket_access_token(uuid, text, text, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_ticket_access(text) to anon, authenticated, service_role;
grant execute on function public.add_ticket_public_comment_by_token(text, text) to anon, authenticated, service_role;
grant execute on function public.create_ticket_access_token(uuid, text, text, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) to authenticated;
revoke all on sequence public.ticket_number_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.ticket_number_seq to authenticated, service_role;
create index profiles_tenant_idx on public.profiles (tenant_id);
create index profiles_role_idx on public.profiles (role);
create index reporters_tenant_idx on public.reporters (tenant_id);
create index reporters_profile_idx on public.reporters (profile_id);
create unique index reporters_tenant_email_uniq
  on public.reporters (tenant_id, lower(email)) where email is not null;
create unique index reporters_tenant_phone_uniq
  on public.reporters (tenant_id, phone) where phone is not null;
create index tickets_tenant_created_idx on public.tickets (tenant_id, created_at desc);
create index tickets_creator_created_idx on public.tickets (created_by_user_id, created_at desc);
create index tickets_reporter_idx on public.tickets (reporter_id);
create index tickets_agent_status_idx on public.tickets (assigned_agent_id, status);
create index tickets_status_priority_idx on public.tickets (status, priority);
create index ticket_comments_ticket_created_idx on public.ticket_comments (ticket_id, created_at);
create index ticket_attachments_ticket_created_idx on public.ticket_attachments (ticket_id, created_at);
create index ticket_access_tokens_ticket_idx on public.ticket_access_tokens (ticket_id);
create index ticket_access_tokens_reporter_idx on public.ticket_access_tokens (reporter_id);
create index audit_events_tenant_created_idx on public.audit_events (tenant_id, created_at desc);
create index audit_events_resource_idx on public.audit_events (resource_type, resource_id);
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.reporters enable row level security;
alter table public.channels enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_sources enable row level security;
alter table public.ticket_access_tokens enable row level security;
alter table public.audit_events enable row level security;
create policy tenants_read_scope on public.tenants
for select to authenticated
using (id = private.current_tenant_id());
create policy tenants_admin_write on public.tenants
for all to authenticated
using (private.is_tenant_admin(id))
with check (private.is_tenant_admin(id));
create policy profiles_read_scope on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or private.is_tenant_admin(tenant_id)
  or (
    private.current_role() = 'customer_manager'
    and tenant_id = private.current_tenant_id()
  )
  or (
    private.current_role() = 'support_agent'
    and exists (
      select 1
      from public.tickets t
      where private.can_read_ticket(t.id)
        and (t.created_by_user_id = profiles.id or t.assigned_agent_id = profiles.id)
    )
  )
);
create policy profiles_admin_insert on public.profiles
for insert to authenticated
with check (private.is_tenant_admin(tenant_id));
create policy profiles_admin_update on public.profiles
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));
create policy permissions_authenticated_read on public.permissions
for select to authenticated using (true);
create policy role_permissions_authenticated_read on public.role_permissions
for select to authenticated using (true);
create policy reporters_internal_read on public.reporters
for select to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
);
create policy reporters_internal_write on public.reporters
for all to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
)
with check (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
);
create policy channels_authenticated_read on public.channels
for select to authenticated
using (is_active or private.is_tenant_admin(private.current_tenant_id()));
create policy channels_admin_write on public.channels
for all to authenticated
using (private.is_tenant_admin(private.current_tenant_id()))
with check (private.is_tenant_admin(private.current_tenant_id()));
create policy tickets_read_scope on public.tickets
for select to authenticated
using (private.can_read_ticket(id));
create policy tickets_insert_scope on public.tickets
for insert to authenticated
with check (
  (
    private.current_role() in ('customer_user', 'customer_manager')
    and tenant_id = private.current_tenant_id()
    and created_by_user_id = (select auth.uid())
    and status = 'new'
    and assigned_agent_id is null
  )
  or (
    private.current_role() in ('support_agent', 'admin')
    and tenant_id = private.current_tenant_id()
    and created_by_user_id = (select auth.uid())
  )
);
create policy tickets_internal_update on public.tickets
for update to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
)
with check (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
);
create policy tickets_admin_delete on public.tickets
for delete to authenticated using (private.is_tenant_admin(tenant_id));
create policy ticket_comments_read_scope on public.ticket_comments
for select to authenticated
using (
  private.can_read_ticket(ticket_id)
  and (visibility = 'public' or private.is_internal_user())
);
create policy ticket_comments_insert_scope on public.ticket_comments
for insert to authenticated
with check (
  private.can_read_ticket(ticket_id)
  and author_user_id = (select auth.uid())
  and (visibility = 'public' or private.is_internal_user())
);
create policy ticket_comments_update_scope on public.ticket_comments
for update to authenticated
using (
  private.can_read_ticket(ticket_id)
  and (author_user_id = (select auth.uid()) or private.is_internal_user())
)
with check (
  private.can_read_ticket(ticket_id)
  and (
    author_user_id = (select auth.uid())
    or private.is_tenant_admin(tenant_id)
  )
  and (visibility = 'public' or private.is_internal_user())
);
create policy ticket_attachments_read_scope on public.ticket_attachments
for select to authenticated
using (
  private.can_read_ticket(ticket_id)
  and (visibility = 'public' or private.is_internal_user())
);
create policy ticket_attachments_insert_scope on public.ticket_attachments
for insert to authenticated
with check (
  private.can_read_ticket(ticket_id)
  and uploaded_by_user_id = (select auth.uid())
  and bucket = 'ticket-attachments'
  and (visibility = 'public' or private.is_internal_user())
);
create policy ticket_attachments_delete_scope on public.ticket_attachments
for delete to authenticated
using (
  uploaded_by_user_id = (select auth.uid())
  or private.is_tenant_admin(tenant_id)
);
create policy audit_events_read_scope on public.audit_events
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or (
    resource_type = 'ticket'
    and resource_id is not null
    and private.can_read_ticket(resource_id)
    and (private.is_internal_user() or action not like '%internal%')
  )
);
grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.permissions, public.role_permissions to authenticated;
grant select, insert, update, delete on public.reporters, public.channels to authenticated;
grant select, insert, update, delete on public.tickets to authenticated;
grant select, insert, update on public.ticket_comments to authenticated;
grant select, insert, delete on public.ticket_attachments to authenticated;
grant select on public.audit_events to authenticated;
insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-attachments', 'ticket-attachments', false, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
create policy ticket_attachment_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'ticket-attachments'
  and exists (
    select 1 from public.ticket_attachments a
    where a.storage_path = storage.objects.name
      and private.can_read_ticket(a.ticket_id)
      and (a.visibility = 'public' or private.is_internal_user())
  )
);
create policy ticket_attachment_objects_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ticket-attachments'
  and exists (
    select 1 from public.ticket_attachments a
    where a.storage_path = storage.objects.name
      and a.uploaded_by_user_id = (select auth.uid())
      and private.can_read_ticket(a.ticket_id)
  )
);
create policy ticket_attachment_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'ticket-attachments'
  and exists (
    select 1 from public.ticket_attachments a
    where a.storage_path = storage.objects.name
      and (
        a.uploaded_by_user_id = (select auth.uid())
        or private.is_tenant_admin(a.tenant_id)
      )
  )
);
