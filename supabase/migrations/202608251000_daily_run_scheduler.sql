-- Generate Daily runs from active team schedules without an application runtime.

create extension if not exists pg_cron;

-- The original executable migration used PostgreSQL's 0=Sunday convention. The
-- application contract is ISO weekdays: 1=Monday through 7=Sunday.
alter table public.team_daily_schedules
  drop constraint if exists team_daily_schedules_weekdays_check;

update public.team_daily_schedules
set scheduled_weekdays = array_replace(scheduled_weekdays, 0::smallint, 7::smallint)
where 0::smallint = any(scheduled_weekdays);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where c.conname = 'team_daily_schedules_weekdays_check'
      and r.relname = 'team_daily_schedules'
      and n.nspname = 'public'
  ) then
    alter table public.team_daily_schedules
      add constraint team_daily_schedules_weekdays_check check (
        cardinality(scheduled_weekdays) between 1 and 7
        and scheduled_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      );
  end if;
end;
$$;

-- Keep the existing trigger as the single owner of derived run fields. This
-- replacement only aligns its weekday comparison with the stored contract.
create or replace function private.prepare_daily_run()
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
     or not coalesce(
       extract(isodow from new.scheduled_for at time zone v_schedule.timezone_name)::smallint
         = any(v_schedule.scheduled_weekdays),
       false
     ) then
    raise exception 'The Daily run does not match its team schedule occurrence';
  end if;

  return new;
exception
  when no_data_found then
    raise exception 'A Daily run requires the active schedule for its team';
end;
$$;

alter function private.prepare_daily_run() owner to postgres;
revoke all on function private.prepare_daily_run() from public, anon, authenticated, service_role;

create or replace function private.generate_daily_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_created_count integer := 0;
  v_inserted_count integer;
  v_schedule record;
  v_local_now timestamp;
  v_local_occurrence timestamp;
  v_scheduled_for timestamptz;
  v_local_weekday smallint;
begin
  for v_schedule in
    select
      s.id,
      s.tenant_id,
      s.team_id,
      s.timezone_name,
      s.local_time,
      s.scheduled_weekdays
    from public.team_daily_schedules s
    join public.teams t
      on t.tenant_id = s.tenant_id
     and t.id = s.team_id
    where s.is_active
      and t.archived_at is null
    order by s.id
  loop
    begin
      -- AT TIME ZONE uses the schedule's stored IANA zone. An invalid zone or
      -- a nonexistent DST wall time is isolated to this schedule below.
      v_local_now := v_now at time zone v_schedule.timezone_name;
      v_local_weekday := extract(isodow from v_local_now)::smallint;

      if not coalesce(v_local_weekday = any(v_schedule.scheduled_weekdays), false)
         or v_local_now::time < v_schedule.local_time then
        continue;
      end if;

      v_local_occurrence := v_local_now::date + v_schedule.local_time;
      v_scheduled_for := v_local_occurrence at time zone v_schedule.timezone_name;

      -- PostgreSQL normalizes nonexistent DST wall times. Reject those values
      -- instead of creating a run at a different local time. The timestamp
      -- comparison also prevents a selected fallback occurrence from being
      -- created before its actual instant has arrived.
      if (v_scheduled_for at time zone v_schedule.timezone_name)
           is distinct from v_local_occurrence
         or v_scheduled_for > v_now then
        continue;
      end if;

      insert into public.daily_runs (tenant_id, team_id, schedule_id, scheduled_for)
      values (v_schedule.tenant_id, v_schedule.team_id, v_schedule.id, v_scheduled_for)
      on conflict (team_id, local_date) do nothing;

      get diagnostics v_inserted_count = row_count;
      v_created_count := v_created_count + v_inserted_count;
    exception
      when others then
        -- A malformed legacy row or a concurrent schedule change must not stop
        -- other tenants' schedules. No row data or error text is logged.
        raise warning 'Daily run scheduler skipped one invalid schedule';
    end;
  end loop;

  return v_created_count;
end;
$$;

alter function private.generate_daily_runs() owner to postgres;
revoke all on function private.generate_daily_runs() from public, anon, authenticated, service_role;

do $$
declare
  v_job_exists boolean;
begin
  select exists (
    select 1
    from cron.job j
    where j.jobname = 'daily-run-generator'
  )
    into v_job_exists;

  if not v_job_exists then
    perform cron.schedule(
      'daily-run-generator',
      '*/5 * * * *',
      'select private.generate_daily_runs();'
    );
  end if;
end;
$$;
