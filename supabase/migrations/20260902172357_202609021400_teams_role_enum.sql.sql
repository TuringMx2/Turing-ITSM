-- Team membership roles + fix superadmin trigger + membership RLS role-agnostic

-- 1. Team member role enum
do $$ begin
  create type public.team_member_role as enum ('team_lead', 'member', 'viewer');
exception when duplicate_object then null; end $$;

alter type public.team_member_role owner to postgres;

-- 2. Add role column to team_memberships with default
alter table public.team_memberships
  add column if not exists role public.team_member_role not null default 'member';

-- 3. Role check (already covered by enum but explicit check for safety)
alter table public.team_memberships
  drop constraint if exists team_memberships_role_check;

-- 4. Re-create the membership-assert trigger function so superadmins are also valid internal users
create or replace function private.assert_internal_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = new.user_id and p.tenant_id = new.tenant_id;
  if v_role not in ('support_agent', 'admin', 'superadmin') then
    raise exception 'Team and project memberships require an internal user';
  end if;
  return new;
end;
$$;

alter function private.assert_internal_membership() owner to postgres;
revoke execute on function private.assert_internal_membership() from public;

-- 5. Re-create shares_internal_membership (still same logic; refresh owner/grants)
create or replace function private.shares_internal_membership(
  p_tenant_id uuid,
  p_other_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id = private.current_tenant_id()
  and (
    exists (
    select 1
    from public.team_memberships mine
    join public.team_memberships theirs
      on theirs.team_id = mine.team_id
    where mine.user_id = (select auth.uid())
      and mine.tenant_id = p_tenant_id
      and theirs.tenant_id = p_tenant_id
      and theirs.user_id = p_other_user_id
    ) or exists (
    select 1
    from public.project_memberships mine
    join public.project_memberships theirs
      on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and mine.tenant_id = p_tenant_id
      and theirs.tenant_id = p_tenant_id
      and theirs.user_id = p_other_user_id
    )
  )
$$;

alter function private.shares_internal_membership(uuid, uuid) owner to postgres;
revoke execute on function private.shares_internal_membership(uuid, uuid) from public;
grant execute on function private.shares_internal_membership(uuid, uuid) to authenticated;

-- 6. Helper: enforce single team_lead per team (trigger on team_memberships)
create or replace function private.enforce_single_team_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_existing_lead uuid;
begin
  if new.role = 'team_lead' then
    select tm.user_id into v_existing_lead
    from public.team_memberships tm
    where tm.tenant_id = new.tenant_id
      and tm.team_id = new.team_id
      and tm.role = 'team_lead'
      and tm.user_id <> new.user_id
    limit 1;
    if v_existing_lead is not null then
      raise exception 'Only one team_lead is allowed per team (user_id: %)', v_existing_lead;
    end if;
  end if;
  return new;
end;
$$;

alter function private.enforce_single_team_lead() owner to postgres;
revoke execute on function private.enforce_single_team_lead() from public;

drop trigger if exists enforce_single_team_lead_tgr on public.team_memberships;

create trigger enforce_single_team_lead_tgr
before insert or update of role on public.team_memberships
for each row execute function private.enforce_single_team_lead();

-- 7. Backfill notes:
-- Existing rows already get role='member' by the DEFAULT added in step 2.
-- Team leads must be assigned manually from the People module once.
;
