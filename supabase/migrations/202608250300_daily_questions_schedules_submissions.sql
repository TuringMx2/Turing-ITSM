-- Daily question catalog, per-team schedules and runs, and immutable submissions.

create table public.daily_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  question_text text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint daily_questions_text_check check (
    char_length(btrim(question_text)) between 3 and 500
  ),
  constraint daily_questions_deactivation_check check (
    (is_active and deactivated_at is null)
    or (not is_active and deactivated_at is not null)
  ),
  constraint daily_questions_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, question_text)
);

insert into public.daily_questions (tenant_id, question_text)
select t.id, defaults.question_text
from public.tenants t
cross join (values
  ('What did you complete since your last update?'),
  ('What will you work on next?'),
  ('Are there any blockers or risks?')
) as defaults(question_text);

create function private.seed_default_daily_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_questions (tenant_id, question_text) values
    (new.id, 'What did you complete since your last update?'),
    (new.id, 'What will you work on next?'),
    (new.id, 'Are there any blockers or risks?');
  return new;
end;
$$;

alter function private.seed_default_daily_questions() owner to postgres;
revoke execute on function private.seed_default_daily_questions() from public;

create trigger seed_tenant_daily_questions_after_insert
after insert on public.tenants
for each row execute function private.seed_default_daily_questions();

create table public.team_daily_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  timezone_name text not null,
  local_time time not null,
  scheduled_weekdays smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  response_window interval not null default interval '8 hours',
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_daily_schedules_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete cascade,
  constraint team_daily_schedules_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint team_daily_schedules_weekdays_check check (
    cardinality(scheduled_weekdays) between 1 and 7
    and scheduled_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint team_daily_schedules_window_check check (
    response_window > interval '0 seconds'
    and response_window <= interval '7 days'
  ),
  unique (team_id),
  unique (tenant_id, id),
  unique (tenant_id, team_id, id)
);

create table public.team_daily_questions (
  tenant_id uuid not null,
  team_id uuid not null,
  question_id uuid not null,
  position smallint not null,
  selected_by uuid not null,
  selected_at timestamptz not null default now(),
  primary key (team_id, question_id),
  constraint team_daily_questions_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete cascade,
  constraint team_daily_questions_question_tenant_fk
    foreign key (tenant_id, question_id)
    references public.daily_questions (tenant_id, id)
    on delete restrict,
  constraint team_daily_questions_selector_tenant_fk
    foreign key (tenant_id, selected_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint team_daily_questions_position_check check (position between 1 and 3),
  unique (team_id, position),
  unique (tenant_id, team_id, question_id)
);

create table public.daily_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  schedule_id uuid not null,
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  local_date date not null,
  timezone_snapshot text not null,
  created_at timestamptz not null default now(),
  constraint daily_runs_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete restrict,
  constraint daily_runs_schedule_tenant_fk
    foreign key (tenant_id, team_id, schedule_id)
    references public.team_daily_schedules (tenant_id, team_id, id)
    on delete restrict,
  constraint daily_runs_due_check check (due_at > scheduled_for),
  unique (team_id, scheduled_for),
  unique (team_id, local_date),
  unique (tenant_id, id),
  unique (tenant_id, team_id, id)
);

create table public.daily_run_questions (
  tenant_id uuid not null,
  run_id uuid not null,
  team_id uuid not null,
  question_id uuid not null,
  question_text text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  primary key (run_id, question_id),
  constraint daily_run_questions_run_tenant_fk
    foreign key (tenant_id, team_id, run_id)
    references public.daily_runs (tenant_id, team_id, id)
    on delete cascade,
  constraint daily_run_questions_question_tenant_fk
    foreign key (tenant_id, question_id)
    references public.daily_questions (tenant_id, id)
    on delete restrict,
  constraint daily_run_questions_position_check check (position between 1 and 3),
  unique (run_id, position),
  unique (tenant_id, run_id, question_id)
);

create table public.daily_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null,
  submitted_at timestamptz not null default now(),
  constraint daily_submissions_profile_tenant_fk
    foreign key (tenant_id, user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, id, user_id)
);

create table public.daily_submission_runs (
  tenant_id uuid not null,
  submission_id uuid not null,
  user_id uuid not null,
  run_id uuid not null,
  team_id uuid not null,
  due_at_snapshot timestamptz not null,
  linked_at timestamptz not null default now(),
  primary key (submission_id, run_id),
  constraint daily_submission_runs_submission_tenant_fk
    foreign key (tenant_id, submission_id, user_id)
    references public.daily_submissions (tenant_id, id, user_id)
    on delete restrict,
  constraint daily_submission_runs_run_tenant_fk
    foreign key (tenant_id, team_id, run_id)
    references public.daily_runs (tenant_id, team_id, id)
    on delete restrict,
  unique (run_id, user_id),
  unique (tenant_id, submission_id, run_id)
);

create table public.daily_submission_answers (
  tenant_id uuid not null,
  submission_id uuid not null,
  user_id uuid not null,
  question_id uuid not null,
  question_text text not null,
  answer_text text not null,
  created_at timestamptz not null default now(),
  primary key (submission_id, question_id),
  constraint daily_submission_answers_submission_tenant_fk
    foreign key (tenant_id, submission_id, user_id)
    references public.daily_submissions (tenant_id, id, user_id)
    on delete restrict,
  constraint daily_submission_answers_question_tenant_fk
    foreign key (tenant_id, question_id)
    references public.daily_questions (tenant_id, id)
    on delete restrict,
  constraint daily_submission_answers_text_check check (
    char_length(btrim(answer_text)) between 1 and 4000
  ),
  unique (tenant_id, submission_id, question_id)
);

create function private.validate_daily_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz
    where tz.name = new.timezone_name
  ) then
    raise exception 'The Daily schedule timezone is not recognized';
  end if;

  if cardinality(new.scheduled_weekdays)
     <> cardinality(array(select distinct unnest(new.scheduled_weekdays))) then
    raise exception 'Daily schedule weekdays cannot contain duplicates';
  end if;

  return new;
end;
$$;

create function private.validate_team_daily_question()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.daily_questions q
  where q.tenant_id = new.tenant_id
    and q.id = new.question_id
    and q.is_active
  for share;

  if not found then
    raise exception 'Teams may select only active Daily questions';
  end if;
  return new;
end;
$$;

create function private.apply_question_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active then
    new.deactivated_at := coalesce(new.deactivated_at, now());
    delete from public.team_daily_questions tdq
    where tdq.tenant_id = old.tenant_id and tdq.question_id = old.id;
  elsif not old.is_active and new.is_active then
    new.deactivated_at := null;
  end if;
  return new;
end;
$$;

create function private.prevent_daily_question_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Daily questions must be soft-deactivated, not deleted';
end;
$$;

create function private.prepare_daily_run()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_schedule public.team_daily_schedules%rowtype;
begin
  select s.* into strict v_schedule
  from public.team_daily_schedules s
  where s.id = new.schedule_id
    and s.team_id = new.team_id
    and s.tenant_id = new.tenant_id
    and s.is_active;

  new.timezone_snapshot := v_schedule.timezone_name;
  new.local_date := (new.scheduled_for at time zone v_schedule.timezone_name)::date;
  new.due_at := new.scheduled_for + v_schedule.response_window;

  if (new.scheduled_for at time zone v_schedule.timezone_name)::time
       is distinct from v_schedule.local_time
     or extract(dow from new.scheduled_for at time zone v_schedule.timezone_name)::smallint
       <> all(v_schedule.scheduled_weekdays) then
    raise exception 'The Daily run does not match its team schedule occurrence';
  end if;

  return new;
exception
  when no_data_found then
    raise exception 'A Daily run requires the active schedule for its team';
end;
$$;

create function private.snapshot_daily_run_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_run_questions (
    tenant_id, run_id, team_id, question_id, question_text, position
  )
  select
    new.tenant_id,
    new.id,
    new.team_id,
    q.id,
    q.question_text,
    tdq.position
  from public.team_daily_questions tdq
  join public.daily_questions q
    on q.tenant_id = tdq.tenant_id
   and q.id = tdq.question_id
  where tdq.team_id = new.team_id
    and tdq.tenant_id = new.tenant_id
    and q.is_active
  order by tdq.position;
  return new;
end;
$$;

create function private.prevent_immutable_daily_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Submitted Daily responses and their evidence are immutable';
end;
$$;

create function private.prevent_daily_run_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Daily run schedule-derived occurrence evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger validate_team_daily_schedule
before insert or update on public.team_daily_schedules
for each row execute function private.validate_daily_schedule();

create trigger set_team_daily_schedules_updated_at
before update on public.team_daily_schedules
for each row execute function private.set_updated_at();

create trigger validate_team_daily_question_selection
before insert or update on public.team_daily_questions
for each row execute function private.validate_team_daily_question();

create trigger apply_daily_question_deactivation
before update of is_active on public.daily_questions
for each row execute function private.apply_question_deactivation();

create trigger prevent_daily_question_delete
before delete on public.daily_questions
for each row execute function private.prevent_daily_question_delete();

create trigger set_daily_questions_updated_at
before update on public.daily_questions
for each row execute function private.set_updated_at();

create trigger prepare_daily_run_before_insert
before insert on public.daily_runs
for each row execute function private.prepare_daily_run();

create trigger snapshot_daily_run_questions_after_insert
after insert on public.daily_runs
for each row execute function private.snapshot_daily_run_questions();

create trigger prevent_daily_run_change
before update on public.daily_runs
for each row execute function private.prevent_daily_run_change();

create trigger prevent_daily_run_question_change
before update or delete on public.daily_run_questions
for each row execute function private.prevent_immutable_daily_change();

create trigger prevent_daily_submission_change
before update or delete on public.daily_submissions
for each row execute function private.prevent_immutable_daily_change();

create trigger prevent_daily_submission_run_change
before update or delete on public.daily_submission_runs
for each row execute function private.prevent_immutable_daily_change();

create trigger prevent_daily_submission_answer_change
before update or delete on public.daily_submission_answers
for each row execute function private.prevent_immutable_daily_change();

revoke execute on function private.validate_daily_schedule() from public;
revoke execute on function private.validate_team_daily_question() from public;
revoke execute on function private.apply_question_deactivation() from public;
revoke execute on function private.prevent_daily_question_delete() from public;
revoke execute on function private.prepare_daily_run() from public;
revoke execute on function private.snapshot_daily_run_questions() from public;
revoke execute on function private.prevent_immutable_daily_change() from public;
revoke execute on function private.prevent_daily_run_change() from public;

create function private.can_read_daily_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.daily_submissions s
      where s.id = p_submission_id
        and private.is_tenant_admin(s.tenant_id)
    )
    or exists (
      select 1 from public.daily_submissions s
      where s.id = p_submission_id
        and s.tenant_id = private.current_tenant_id()
        and s.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.daily_submission_runs sr
      where sr.submission_id = p_submission_id
        and private.is_team_member(sr.tenant_id, sr.team_id)
    )
$$;

create function private.can_read_daily_answer(
  p_submission_id uuid,
  p_question_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.daily_submissions s
      where s.id = p_submission_id
        and private.is_tenant_admin(s.tenant_id)
    )
    or exists (
      select 1 from public.daily_submissions s
      where s.id = p_submission_id
        and s.tenant_id = private.current_tenant_id()
        and s.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.daily_submission_runs sr
      join public.daily_run_questions rq
        on rq.run_id = sr.run_id
       and rq.question_id = p_question_id
      where sr.submission_id = p_submission_id
        and private.is_team_member(sr.tenant_id, sr.team_id)
    )
$$;

alter function private.can_read_daily_submission(uuid) owner to postgres;
alter function private.can_read_daily_answer(uuid, uuid) owner to postgres;
revoke execute on function private.can_read_daily_submission(uuid) from public;
revoke execute on function private.can_read_daily_answer(uuid, uuid) from public;
grant execute on function private.can_read_daily_submission(uuid) to authenticated;
grant execute on function private.can_read_daily_answer(uuid, uuid) to authenticated;

create function public.submit_daily_response(
  p_run_ids uuid[],
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_submission_id uuid;
  v_run_count integer;
  v_question_count integer;
  v_answer_count integer;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  if p_run_ids is null or cardinality(p_run_ids) = 0 then
    raise exception 'At least one Daily run is required';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'Daily answers must be a JSON array';
  end if;

  select count(*), min(r.tenant_id::text)::uuid
    into v_run_count, v_tenant_id
  from public.daily_runs r
  where r.id = any(p_run_ids)
    and (
      private.is_tenant_admin(r.tenant_id)
      or exists (
        select 1 from public.team_memberships tm
        where tm.tenant_id = r.tenant_id
          and tm.team_id = r.team_id
          and tm.user_id = v_user_id
      )
    );

  if v_run_count <> cardinality(p_run_ids)
     or v_run_count <> (
       select count(distinct ids.run_id)
       from unnest(p_run_ids) as ids(run_id)
     ) then
    raise exception 'One or more Daily runs are missing, duplicated, or inaccessible';
  end if;

  if exists (
    select 1 from public.daily_runs r
    where r.id = any(p_run_ids) and r.tenant_id <> v_tenant_id
  ) then
    raise exception 'A submission cannot span tenants';
  end if;

  if v_tenant_id is distinct from private.current_tenant_id() then
    raise exception 'The Daily runs do not belong to the current tenant';
  end if;

  if exists (
    select 1 from public.daily_submission_runs sr
    where sr.run_id = any(p_run_ids) and sr.user_id = v_user_id
  ) then
    raise exception 'A Daily run already has a submission from this user';
  end if;

  with expected as (
    select distinct rq.question_id
    from public.daily_run_questions rq
    where rq.run_id = any(p_run_ids)
  ), supplied as (
    select
      (item ->> 'question_id')::uuid as question_id,
      item ->> 'answer' as answer_text
    from jsonb_array_elements(p_answers) item
  )
  select
    (select count(*) from expected),
    (select count(*) from supplied)
  into v_question_count, v_answer_count;

  if v_answer_count <> v_question_count then
    raise exception 'Answers must match the deduplicated question union';
  end if;

  if exists (
    select 1
    from (
      select
        (item ->> 'question_id')::uuid as question_id,
        item ->> 'answer' as answer_text
      from jsonb_array_elements(p_answers) item
    ) supplied
    where supplied.answer_text is null
       or char_length(btrim(supplied.answer_text)) not between 1 and 4000
  ) then
    raise exception 'Every Daily answer must contain 1 to 4000 characters';
  end if;

  if exists (
    select supplied.question_id
    from (
      select (item ->> 'question_id')::uuid as question_id
      from jsonb_array_elements(p_answers) item
    ) supplied
    group by supplied.question_id
    having count(*) > 1
  ) or exists (
    select 1
    from (
      select (item ->> 'question_id')::uuid as question_id
      from jsonb_array_elements(p_answers) item
    ) supplied
    full join (
      select distinct rq.question_id
      from public.daily_run_questions rq
      where rq.run_id = any(p_run_ids)
    ) expected using (question_id)
    where supplied.question_id is null or expected.question_id is null
  ) then
    raise exception 'Answers must contain each required canonical question exactly once';
  end if;

  insert into public.daily_submissions (tenant_id, user_id)
  values (v_tenant_id, v_user_id)
  returning id into v_submission_id;

  insert into public.daily_submission_runs (
    tenant_id, submission_id, user_id, run_id, team_id, due_at_snapshot
  )
  select
    r.tenant_id, v_submission_id, v_user_id, r.id, r.team_id, r.due_at
  from public.daily_runs r
  where r.id = any(p_run_ids);

  insert into public.daily_submission_answers (
    tenant_id, submission_id, user_id, question_id, question_text, answer_text
  )
  select
    v_tenant_id,
    v_submission_id,
    v_user_id,
    supplied.question_id,
    evidence.question_text,
    supplied.answer_text
  from (
    select
      (item ->> 'question_id')::uuid as question_id,
      btrim(item ->> 'answer') as answer_text
    from jsonb_array_elements(p_answers) item
  ) supplied
  join lateral (
    select rq.question_text
    from public.daily_run_questions rq
    where rq.run_id = any(p_run_ids)
      and rq.question_id = supplied.question_id
    order by rq.run_id
    limit 1
  ) evidence on true;

  return v_submission_id;
end;
$$;

alter function public.submit_daily_response(uuid[], jsonb) owner to postgres;
revoke execute on function public.submit_daily_response(uuid[], jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_daily_response(uuid[], jsonb) to authenticated;

create index team_daily_questions_question_idx on public.team_daily_questions (question_id);
create index daily_runs_team_scheduled_idx on public.daily_runs (team_id, scheduled_for desc);
create index daily_runs_due_idx on public.daily_runs (due_at);
create index daily_submission_runs_user_idx on public.daily_submission_runs (user_id, linked_at desc);
create index daily_submission_runs_team_idx on public.daily_submission_runs (team_id, run_id);
create index daily_submission_answers_question_idx on public.daily_submission_answers (question_id);

alter table public.daily_questions enable row level security;
alter table public.team_daily_schedules enable row level security;
alter table public.team_daily_questions enable row level security;
alter table public.daily_runs enable row level security;
alter table public.daily_run_questions enable row level security;
alter table public.daily_submissions enable row level security;
alter table public.daily_submission_runs enable row level security;
alter table public.daily_submission_answers enable row level security;

create policy daily_questions_read_scope on public.daily_questions
for select to authenticated
using (
  tenant_id = private.current_tenant_id()
  and (is_active or private.is_tenant_admin(tenant_id))
);

create policy daily_questions_admin_insert on public.daily_questions
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy daily_questions_admin_update on public.daily_questions
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy team_daily_schedules_read_scope on public.team_daily_schedules
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, team_id)
);

create policy team_daily_schedules_admin_insert on public.team_daily_schedules
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy team_daily_schedules_admin_update on public.team_daily_schedules
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy team_daily_schedules_admin_delete on public.team_daily_schedules
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy team_daily_questions_read_scope on public.team_daily_questions
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, team_id)
);

create policy team_daily_questions_admin_insert on public.team_daily_questions
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and selected_by = (select auth.uid())
);

create policy team_daily_questions_admin_update on public.team_daily_questions
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy team_daily_questions_admin_delete on public.team_daily_questions
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy daily_runs_read_scope on public.daily_runs
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, team_id)
);

create policy daily_runs_admin_insert on public.daily_runs
for insert to authenticated
with check (private.is_tenant_admin(tenant_id));

create policy daily_run_questions_read_scope on public.daily_run_questions
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, team_id)
);

create policy daily_submissions_read_scope on public.daily_submissions
for select to authenticated
using (private.can_read_daily_submission(id));

create policy daily_submission_runs_read_scope on public.daily_submission_runs
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or user_id = (select auth.uid())
  or private.is_team_member(tenant_id, team_id)
);

create policy daily_submission_answers_read_scope on public.daily_submission_answers
for select to authenticated
using (private.can_read_daily_answer(submission_id, question_id));

grant select, insert, update on public.daily_questions to authenticated;
grant select, insert, update, delete on public.team_daily_schedules to authenticated;
grant select, insert, update, delete on public.team_daily_questions to authenticated;
grant select, insert on public.daily_runs to authenticated;
grant select on public.daily_run_questions to authenticated;
grant select on public.daily_submissions to authenticated;
grant select on public.daily_submission_runs to authenticated;
grant select on public.daily_submission_answers to authenticated;
