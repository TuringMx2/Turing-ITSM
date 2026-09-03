-- Daily-specific planned work items and immutable end-of-day completion evidence.

alter table public.daily_questions
  add column semantic_key text;

alter table public.daily_questions
  add constraint daily_questions_semantic_key_check check (
    semantic_key is null or semantic_key in ('completed_work', 'planned_work', 'blockers')
  );

create unique index daily_questions_tenant_semantic_key_uniq
  on public.daily_questions (tenant_id, semantic_key)
  where semantic_key is not null;

update public.daily_questions
set semantic_key = case question_text
  when 'What did you complete since your last update?' then 'completed_work'
  when 'What will you work on next?' then 'planned_work'
  when 'Are there any blockers or risks?' then 'blockers'
  else semantic_key
end
where semantic_key is null
  and question_text in (
    'What did you complete since your last update?',
    'What will you work on next?',
    'Are there any blockers or risks?'
  );

create or replace function private.seed_default_daily_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_questions (tenant_id, question_text, semantic_key) values
    (new.id, 'What did you complete since your last update?', 'completed_work'),
    (new.id, 'What will you work on next?', 'planned_work'),
    (new.id, 'Are there any blockers or risks?', 'blockers');
  return new;
end;
$$;

create or replace function private.prevent_daily_question_semantic_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.semantic_key is distinct from old.semantic_key
     and exists (
       select 1
       from public.daily_submission_answers a
       where a.tenant_id = old.tenant_id
         and a.question_id = old.id
     ) then
    raise exception 'Daily question semantics are immutable after evidence is recorded';
  end if;
  return new;
end;
$$;

create trigger prevent_daily_question_semantic_change
before update of semantic_key on public.daily_questions
for each row execute function private.prevent_daily_question_semantic_change();

alter table public.daily_run_questions
  add column semantic_key text;

alter table public.daily_run_questions
  add constraint daily_run_questions_semantic_key_check check (
    semantic_key is null or semantic_key in ('completed_work', 'planned_work', 'blockers')
  );

create or replace function private.snapshot_daily_run_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_run_questions (
    tenant_id, run_id, team_id, question_id, question_text, semantic_key, position
  )
  select
    new.tenant_id,
    new.id,
    new.team_id,
    q.id,
    q.question_text,
    q.semantic_key,
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

create table public.daily_task_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  logical_date date not null,
  title text not null,
  position integer not null,
  carried_from_id uuid,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_task_items_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete restrict,
  constraint daily_task_items_user_tenant_fk
    foreign key (tenant_id, user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint daily_task_items_carried_from_fk
    foreign key (tenant_id, carried_from_id)
    references public.daily_task_items (tenant_id, id)
    on delete restrict,
  constraint daily_task_items_title_check check (char_length(btrim(title)) between 1 and 400),
  constraint daily_task_items_position_check check (position > 0),
  constraint daily_task_items_status_check check (status in ('planned', 'completed', 'deleted', 'carried')),
  unique (tenant_id, id),
  unique (tenant_id, id, team_id, user_id),
  unique (tenant_id, team_id, user_id, logical_date, position)
);

create table public.daily_task_completions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  logical_date date not null,
  submitted_at timestamptz not null default now(),
  timezone_snapshot text not null,
  constraint daily_task_completions_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete restrict,
  constraint daily_task_completions_user_tenant_fk
    foreign key (tenant_id, user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, id, team_id, user_id),
  unique (tenant_id, team_id, user_id, logical_date)
);

create table public.daily_task_completion_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  completion_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  task_id uuid not null,
  title_snapshot text not null,
  position integer not null,
  outcome text not null,
  next_task_id uuid,
  created_at timestamptz not null default now(),
  constraint daily_task_completion_items_completion_fk
    foreign key (tenant_id, completion_id, team_id, user_id)
    references public.daily_task_completions (tenant_id, id, team_id, user_id)
    on delete restrict,
  constraint daily_task_completion_items_task_fk
    foreign key (tenant_id, task_id, team_id, user_id)
    references public.daily_task_items (tenant_id, id, team_id, user_id)
    on delete restrict,
  constraint daily_task_completion_items_next_task_fk
    foreign key (tenant_id, next_task_id, team_id, user_id)
    references public.daily_task_items (tenant_id, id, team_id, user_id)
    on delete restrict,
  constraint daily_task_completion_items_title_check check (char_length(btrim(title_snapshot)) between 1 and 400),
  constraint daily_task_completion_items_position_check check (position > 0),
  constraint daily_task_completion_items_outcome_check check (outcome in ('completed', 'deleted', 'carried')),
  constraint daily_task_completion_items_next_task_check check (
    (outcome = 'carried' and next_task_id is not null)
    or (outcome <> 'carried' and next_task_id is null)
  ),
  unique (tenant_id, id),
  unique (tenant_id, completion_id, task_id)
);

create function private.prevent_daily_task_closed_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'planned' then
    raise exception 'Daily task lifecycle evidence is immutable after completion';
  end if;
  return new;
end;
$$;

create function private.prevent_daily_task_completion_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Daily task completion evidence is immutable';
end;
$$;

create trigger set_daily_task_items_updated_at
before update on public.daily_task_items
for each row execute function private.set_updated_at();

create trigger prevent_daily_task_closed_change
before update or delete on public.daily_task_items
for each row execute function private.prevent_daily_task_closed_change();

create trigger prevent_daily_task_completion_change
before update or delete on public.daily_task_completions
for each row execute function private.prevent_daily_task_completion_change();

create trigger prevent_daily_task_completion_item_change
before update or delete on public.daily_task_completion_items
for each row execute function private.prevent_daily_task_completion_change();

create function public.add_daily_task_items(
  p_team_id uuid,
  p_logical_date date,
  p_titles text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_local_now timestamp;
  v_schedule record;
  v_titles text[] := coalesce(p_titles, array[]::text[]);
  v_position integer;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  if cardinality(v_titles) = 0 or cardinality(v_titles) > 100 then
    raise exception 'Daily planned work must contain between 1 and 100 tasks';
  end if;

  if exists (
    select 1
    from unnest(v_titles) title
    where title is null or char_length(btrim(title)) not between 1 and 400
  ) then
    raise exception 'Every Daily planned task must contain 1 to 400 characters';
  end if;

  select p.tenant_id into strict v_tenant_id
  from public.profiles p
  where p.id = v_user_id
    and p.status = 'active';

  if v_tenant_id is distinct from private.current_tenant_id()
     or not (private.is_tenant_admin(v_tenant_id) or private.is_team_member(v_tenant_id, p_team_id)) then
    raise exception 'The selected Daily team is not available to your account';
  end if;

  select s.* into strict v_schedule
  from public.team_daily_schedules s
  join public.teams t
    on t.tenant_id = s.tenant_id
   and t.id = s.team_id
  where s.tenant_id = v_tenant_id
    and s.team_id = p_team_id
    and s.is_active
    and t.archived_at is null
    and nullif(btrim(s.timezone_name), '') is not null
  for share;

  begin
    v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;
  exception
    when invalid_parameter_value then
      raise exception 'The Daily team timezone is invalid';
  end;

  if p_logical_date is null or p_logical_date <> v_local_now::date
     or v_local_now::time >= time '16:00' then
    raise exception 'Daily planned work is closed for the team local date';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_tenant_id::text || ':' || p_team_id::text || ':' || p_logical_date::text || ':' || v_user_id::text,
      0
    )
  );

  select coalesce(max(t.position), 0) + 1
    into v_position
  from public.daily_task_items t
  where t.tenant_id = v_tenant_id
    and t.team_id = p_team_id
    and t.user_id = v_user_id
    and t.logical_date = p_logical_date;

  insert into public.daily_task_items (
    tenant_id, team_id, user_id, logical_date, title, position
  )
  select
    v_tenant_id,
    p_team_id,
    v_user_id,
    p_logical_date,
    btrim(title),
    v_position + ordinal::integer - 1
  from unnest(v_titles) with ordinality as planned(title, ordinal);

  return cardinality(v_titles);
exception
  when no_data_found then
    raise exception 'The Daily team has no active schedule with a valid IANA timezone';
end;
$$;

create function public.submit_daily_response_with_tasks(
  p_run_ids uuid[],
  p_answers jsonb,
  p_local_date date,
  p_planned_task_titles text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_team_id uuid;
  v_team_count integer;
  v_submission_id uuid;
  v_task_titles text[] := array[]::text[];
  v_planned_question_id uuid;
  v_planned_question_count integer;
  v_planned_answer text;
  v_position integer;
  v_schedule record;
  v_local_now timestamp;
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

  -- Kept for compatibility with the initial client contract; task titles are never trusted from it.
  if p_planned_task_titles is not null and cardinality(p_planned_task_titles) > 100 then
    raise exception 'Daily planned work must contain at most 100 tasks';
  end if;

  select count(distinct r.team_id), min(r.team_id::text)::uuid, min(r.tenant_id::text)::uuid
    into v_team_count, v_team_id, v_tenant_id
  from public.daily_runs r
  where r.id = any(p_run_ids)
    and (
      private.is_tenant_admin(r.tenant_id)
      or private.is_team_member(r.tenant_id, r.team_id)
    );

  if v_team_count <> 1 then
    raise exception 'Daily responses and tasks must belong to exactly one team';
  end if;

  if v_tenant_id is distinct from private.current_tenant_id() then
    raise exception 'The Daily runs do not belong to the current tenant';
  end if;

  select count(distinct rq.question_id), min(rq.question_id::text)::uuid
    into v_planned_question_count, v_planned_question_id
  from public.daily_run_questions rq
  left join public.daily_questions q
    on q.tenant_id = rq.tenant_id
   and q.id = rq.question_id
  where rq.run_id = any(p_run_ids)
    and (
      rq.semantic_key = 'planned_work'
      or (rq.semantic_key is null and q.semantic_key = 'planned_work')
    );

  if v_planned_question_count > 1 then
    raise exception 'The selected Daily runs have inconsistent planned-work questions';
  end if;

  if v_planned_question_id is not null then
    select item ->> 'answer'
      into v_planned_answer
    from jsonb_array_elements(p_answers) item
    where (item ->> 'question_id')::uuid = v_planned_question_id
    limit 1;

    v_task_titles := array(
      select btrim(regexp_replace(line, E'^\\s*[-•]\\s?', ''))
      from regexp_split_to_table(coalesce(v_planned_answer, ''), E'\\r?\\n') as lines(line)
      where btrim(regexp_replace(line, E'^\\s*[-•]\\s?', '')) <> ''
    );
  end if;

  if cardinality(v_task_titles) > 100 then
    raise exception 'Daily planned work must contain at most 100 tasks';
  end if;

  if exists (
    select 1
    from unnest(v_task_titles) title
    where title is null or char_length(btrim(title)) not between 1 and 400
  ) then
    raise exception 'Every Daily planned task must contain 1 to 400 characters';
  end if;

  if cardinality(v_task_titles) > 0
     and v_planned_question_id is null then
    raise exception 'The selected Daily run has no planned-work question';
  end if;

  if cardinality(v_task_titles) = 0
     and v_planned_question_id is not null then
    raise exception 'Daily planned work must contain at least one task';
  end if;

  if cardinality(v_task_titles) > 0 then
    select s.* into strict v_schedule
    from public.team_daily_schedules s
    where s.tenant_id = v_tenant_id
      and s.team_id = v_team_id
      and s.is_active
      and nullif(btrim(s.timezone_name), '') is not null;
    begin
      v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;
    exception
      when invalid_parameter_value then
        raise exception 'The Daily team timezone is invalid';
    end;
    if p_local_date <> v_local_now::date or v_local_now::time >= time '16:00' then
      raise exception 'Daily planned work is closed for the team local date';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_tenant_id::text || ':' || v_team_id::text || ':' || p_local_date::text || ':' || v_user_id::text,
      0
    )
  );

  v_submission_id := public.submit_daily_response(p_run_ids, p_answers, p_local_date);

  if cardinality(v_task_titles) > 0 then
    select coalesce(max(t.position), 0) + 1
      into v_position
    from public.daily_task_items t
    where t.tenant_id = v_tenant_id
      and t.team_id = v_team_id
      and t.user_id = v_user_id
      and t.logical_date = p_local_date;

    insert into public.daily_task_items (
      tenant_id, team_id, user_id, logical_date, title, position
    )
    select
      v_tenant_id,
      v_team_id,
      v_user_id,
      p_local_date,
      btrim(title),
      v_position + ordinal::integer - 1
    from unnest(v_task_titles) with ordinality as planned(title, ordinal);
  end if;

  return v_submission_id;
end;
$$;

create function public.submit_daily_task_completion(
  p_team_id uuid,
  p_logical_date date,
  p_completed_task_ids uuid[],
  p_unchecked_resolution text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_local_now timestamp;
  v_schedule record;
  v_task_count integer;
  v_completed_count integer;
  v_distinct_completed_count integer;
  v_unchecked_count integer;
  v_completion_id uuid;
  v_next_task_id uuid;
  v_next_position integer;
  v_completed_ids uuid[] := coalesce(p_completed_task_ids, array[]::uuid[]);
  v_task record;
  v_outcome text;
begin
  if v_user_id is null or not private.is_internal_user() then
    raise exception 'An authenticated internal user is required';
  end if;

  select p.tenant_id into strict v_tenant_id
  from public.profiles p
  where p.id = v_user_id
    and p.status = 'active';

  if v_tenant_id is distinct from private.current_tenant_id()
     or not (private.is_tenant_admin(v_tenant_id) or private.is_team_member(v_tenant_id, p_team_id)) then
    raise exception 'The selected Daily team is not available to your account';
  end if;

  select s.* into strict v_schedule
  from public.team_daily_schedules s
  join public.teams t
    on t.tenant_id = s.tenant_id
   and t.id = s.team_id
  where s.tenant_id = v_tenant_id
    and s.team_id = p_team_id
    and s.is_active
    and t.archived_at is null
    and nullif(btrim(s.timezone_name), '') is not null
  for share;

  begin
    v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;
  exception
    when invalid_parameter_value then
      raise exception 'The Daily team timezone is invalid';
  end;

  if p_logical_date is null or p_logical_date <> v_local_now::date then
    raise exception 'The Daily completion date does not match the team local date';
  end if;

  if v_local_now::time < time '16:00' then
    raise exception 'Daily completion is available after the team local 16:00 cutoff';
  end if;

  select count(*) into v_completed_count from unnest(v_completed_ids);
  select count(distinct completed_id) into v_distinct_completed_count
  from unnest(v_completed_ids) as completed(completed_id);
  if v_completed_count <> v_distinct_completed_count then
    raise exception 'Daily completed task identifiers cannot be duplicated';
  end if;

  select count(*) into v_task_count
  from public.daily_task_items t
  where t.tenant_id = v_tenant_id
    and t.team_id = p_team_id
    and t.user_id = v_user_id
    and t.logical_date = p_logical_date
    and t.status = 'planned';

  if v_task_count = 0 then
    raise exception 'There are no planned Daily tasks to complete';
  end if;

  if exists (
    select 1
    from unnest(v_completed_ids) completed(completed_id)
    where not exists (
      select 1
      from public.daily_task_items t
      where t.id = completed.completed_id
        and t.tenant_id = v_tenant_id
        and t.team_id = p_team_id
        and t.user_id = v_user_id
        and t.logical_date = p_logical_date
        and t.status = 'planned'
    )
  ) then
    raise exception 'A completed Daily task is missing or inaccessible';
  end if;

  v_unchecked_count := v_task_count - v_completed_count;
  if v_unchecked_count > 0 and coalesce(p_unchecked_resolution, '') not in ('delete', 'carry') then
    raise exception 'Choose delete or carry for every unchecked Daily task';
  end if;
  if v_unchecked_count = 0 and coalesce(p_unchecked_resolution, 'none') <> 'none' then
    raise exception 'No unchecked Daily tasks require a resolution';
  end if;

  insert into public.daily_task_completions (
    tenant_id, team_id, user_id, logical_date, timezone_snapshot
  ) values (
    v_tenant_id, p_team_id, v_user_id, p_logical_date, v_schedule.timezone_name
  ) returning id into v_completion_id;

  select coalesce(max(t.position), 0) + 1
    into v_next_position
  from public.daily_task_items t
  where t.tenant_id = v_tenant_id
    and t.team_id = p_team_id
    and t.user_id = v_user_id
    and t.logical_date = p_logical_date + 1
    and t.status = 'planned';

  for v_task in
    select t.id, t.title, t.position
    from public.daily_task_items t
    where t.tenant_id = v_tenant_id
      and t.team_id = p_team_id
      and t.user_id = v_user_id
      and t.logical_date = p_logical_date
      and t.status = 'planned'
    order by t.position, t.id
    for update
  loop
    v_next_task_id := null;
    if v_task.id = any(v_completed_ids) then
      v_outcome := 'completed';
      update public.daily_task_items
      set status = 'completed'
      where tenant_id = v_tenant_id and id = v_task.id;
    elsif p_unchecked_resolution = 'carry' then
      v_outcome := 'carried';
      update public.daily_task_items
      set status = 'carried'
      where tenant_id = v_tenant_id and id = v_task.id;

      insert into public.daily_task_items (
        tenant_id, team_id, user_id, logical_date, title, position, carried_from_id
      ) values (
        v_tenant_id,
        p_team_id,
        v_user_id,
        p_logical_date + 1,
        v_task.title,
        v_next_position,
        v_task.id
      ) returning id into v_next_task_id;
      v_next_position := v_next_position + 1;
    else
      v_outcome := 'deleted';
      update public.daily_task_items
      set status = 'deleted'
      where tenant_id = v_tenant_id and id = v_task.id;
    end if;

    insert into public.daily_task_completion_items (
      tenant_id, completion_id, team_id, user_id, task_id,
      title_snapshot, position, outcome, next_task_id
    ) values (
      v_tenant_id, v_completion_id, p_team_id, v_user_id, v_task.id,
      v_task.title, v_task.position, v_outcome, v_next_task_id
    );
  end loop;

  return v_completion_id;
exception
  when no_data_found then
    raise exception 'The Daily team has no active schedule with a valid IANA timezone';
end;
$$;

alter function private.seed_default_daily_questions() owner to postgres;
alter function private.prevent_daily_question_semantic_change() owner to postgres;
alter function private.snapshot_daily_run_questions() owner to postgres;
alter function private.prevent_daily_task_closed_change() owner to postgres;
alter function private.prevent_daily_task_completion_change() owner to postgres;
alter function public.add_daily_task_items(uuid, date, text[]) owner to postgres;
alter function public.submit_daily_response_with_tasks(uuid[], jsonb, date, text[]) owner to postgres;
alter function public.submit_daily_task_completion(uuid, date, uuid[], text) owner to postgres;

revoke all on function private.seed_default_daily_questions() from public, anon, authenticated, service_role;
revoke all on function private.prevent_daily_question_semantic_change() from public, anon, authenticated, service_role;
revoke all on function private.snapshot_daily_run_questions() from public, anon, authenticated, service_role;
revoke all on function private.prevent_daily_task_closed_change() from public, anon, authenticated, service_role;
revoke all on function private.prevent_daily_task_completion_change() from public, anon, authenticated, service_role;
revoke all on function public.add_daily_task_items(uuid, date, text[]) from public, anon, authenticated, service_role;
revoke all on function public.submit_daily_response_with_tasks(uuid[], jsonb, date, text[]) from public, anon, authenticated, service_role;
revoke all on function public.submit_daily_task_completion(uuid, date, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.add_daily_task_items(uuid, date, text[]) to authenticated;
grant execute on function public.submit_daily_response_with_tasks(uuid[], jsonb, date, text[]) to authenticated;
revoke execute on function public.submit_daily_response(uuid[], jsonb, date) from authenticated;
grant execute on function public.submit_daily_task_completion(uuid, date, uuid[], text) to authenticated;

create index daily_task_items_user_date_idx
  on public.daily_task_items (tenant_id, team_id, user_id, logical_date, position);
create index daily_task_items_carried_from_idx
  on public.daily_task_items (tenant_id, carried_from_id);
create index daily_task_completions_user_date_idx
  on public.daily_task_completions (tenant_id, team_id, user_id, logical_date desc);
create index daily_task_completion_items_completion_idx
  on public.daily_task_completion_items (tenant_id, completion_id, position);

alter table public.daily_task_items enable row level security;
alter table public.daily_task_completions enable row level security;
alter table public.daily_task_completion_items enable row level security;

create policy daily_task_items_read_scope on public.daily_task_items
for select to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
  and (
    user_id = (select auth.uid())
    or private.is_tenant_admin(tenant_id)
  )
);

create policy daily_task_items_insert_scope on public.daily_task_items
for insert to authenticated
with check (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
  and user_id = (select auth.uid())
  and status = 'planned'
   and (private.is_tenant_admin(tenant_id) or private.is_team_member(tenant_id, team_id))
  and exists (
    select 1
    from public.team_daily_schedules s
    where s.tenant_id = daily_task_items.tenant_id
      and s.team_id = daily_task_items.team_id
      and s.is_active
      and daily_task_items.logical_date = (now() at time zone s.timezone_name)::date
      and (now() at time zone s.timezone_name)::time < time '16:00'
  )
);

create policy daily_task_completions_read_scope on public.daily_task_completions
for select to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
  and (
    user_id = (select auth.uid())
    or private.is_tenant_admin(tenant_id)
  )
);

create policy daily_task_completion_items_read_scope on public.daily_task_completion_items
for select to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
  and (
    user_id = (select auth.uid())
    or private.is_tenant_admin(tenant_id)
  )
);

grant select on public.daily_task_items to authenticated;
grant select on public.daily_task_completions to authenticated;
grant select on public.daily_task_completion_items to authenticated;

revoke insert, update, delete on public.daily_task_items from authenticated;
revoke insert, update, delete on public.daily_task_completions from authenticated;
revoke insert, update, delete on public.daily_task_completion_items from authenticated;
