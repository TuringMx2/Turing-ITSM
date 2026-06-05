-- Turing ITSM initial Supabase/Postgres schema baseline.
-- Local migration only. Apply through Supabase CLI/Dashboard after project review.

create extension if not exists "pgcrypto";

-- Enum types ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('customer_user', 'customer_manager', 'support_agent', 'admin');
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

-- Tables -------------------------------------------------------------------
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
  constraint profiles_email_check check (position('@' in email) > 1),
  constraint profiles_customer_tenant_check check (
    (role in ('customer_user', 'customer_manager') and tenant_id is not null)
    or (role in ('support_agent', 'admin'))
  )
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

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  submitter_name text not null,
  company_name text not null,
  department text not null,
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
  constraint tickets_description_length_check check (char_length(description) >= 10)
);

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  author_user_id uuid not null references public.profiles(id) on delete restrict,
  visibility public.comment_visibility not null default 'public',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_comments_body_length_check check (char_length(body) >= 1)
);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  uploaded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  visibility public.attachment_visibility not null default 'public',
  bucket text not null default 'ticket-attachments',
  storage_path text not null unique,
  file_name text not null,
  mime_type text null,
  size_bytes bigint null,
  created_at timestamptz not null default now(),
  constraint ticket_attachments_bucket_check check (bucket = 'ticket-attachments'),
  constraint ticket_attachments_size_check check (size_bytes is null or size_bytes >= 0)
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

-- Seeds --------------------------------------------------------------------
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

insert into public.role_permissions (role, permission_key) values
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
on conflict (role, permission_key) do nothing;

-- Triggers and helper functions -------------------------------------------
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

create or replace function public.prevent_ticket_comment_author_change()
returns trigger
language plpgsql
as $$
begin
  if new.author_user_id is distinct from old.author_user_id then
    raise exception 'ticket_comments.author_user_id cannot be changed';
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

create or replace function public.can_read_ticket(ticket_row public.tickets)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_role()
    when 'customer_user' then ticket_row.tenant_id = public.current_tenant_id() and ticket_row.created_by_user_id = auth.uid()
    when 'customer_manager' then ticket_row.tenant_id = public.current_tenant_id()
    when 'support_agent' then true
    when 'admin' then true
    else false
  end
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

-- Indexes ------------------------------------------------------------------
create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists tickets_tenant_created_at_idx on public.tickets (tenant_id, created_at desc);
create index if not exists tickets_created_by_created_at_idx on public.tickets (created_by_user_id, created_at desc);
create index if not exists tickets_assigned_agent_status_idx on public.tickets (assigned_agent_id, status);
create index if not exists tickets_status_priority_idx on public.tickets (status, priority);
create index if not exists ticket_comments_ticket_created_at_idx on public.ticket_comments (ticket_id, created_at);
create index if not exists ticket_comments_tenant_visibility_idx on public.ticket_comments (tenant_id, visibility);
create index if not exists ticket_attachments_ticket_created_at_idx on public.ticket_attachments (ticket_id, created_at);
create index if not exists ticket_attachments_tenant_visibility_idx on public.ticket_attachments (tenant_id, visibility);
create index if not exists audit_events_tenant_created_at_idx on public.audit_events (tenant_id, created_at desc);
create index if not exists audit_events_resource_idx on public.audit_events (resource_type, resource_id);
create index if not exists audit_events_actor_user_idx on public.audit_events (actor_user_id);

-- Row Level Security -------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.audit_events enable row level security;

-- Policy creation guarded for repeatable local development.
do $$
begin
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

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_by_scope') then
    create policy profiles_select_by_scope on public.profiles
      for select to authenticated
      using (
        id = auth.uid()
        or public.is_admin()
        or (public.current_role() = 'customer_manager' and tenant_id = public.current_tenant_id())
        or (public.current_role() = 'support_agent' and id in (
          select created_by_user_id from public.tickets where public.can_read_ticket(tickets)
          union
          select assigned_agent_id from public.tickets where assigned_agent_id is not null and public.can_read_ticket(tickets)
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

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_select_by_role_scope') then
    create policy tickets_select_by_role_scope on public.tickets
      for select to authenticated
      using (public.can_read_ticket(tickets));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets' and policyname = 'tickets_insert_by_role_scope') then
    create policy tickets_insert_by_role_scope on public.tickets
      for insert to authenticated
      with check (
        (
          public.current_role() in ('customer_user', 'customer_manager')
          and tenant_id = public.current_tenant_id()
          and created_by_user_id = auth.uid()
        )
        or (
          public.current_role() in ('support_agent', 'admin')
          and created_by_user_id = auth.uid()
        )
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
        and (author_user_id = auth.uid() or public.is_internal_user())
        and (visibility = 'public' or public.is_internal_user())
      );
  end if;

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
end $$;
