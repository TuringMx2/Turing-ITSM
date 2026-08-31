-- Bind Daily submissions to the logical local date selected by the caller.

drop function if exists public.submit_daily_response(uuid[], jsonb);

create or replace function public.submit_daily_response(
  p_run_ids uuid[],
  p_answers jsonb,
  p_local_date date
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

  if p_local_date is null then
    raise exception 'A selected Daily local date is required';
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
    select 1
    from public.daily_runs r
    where r.id = any(p_run_ids)
      and r.local_date is distinct from p_local_date
  ) then
    raise exception 'The Daily runs do not match the selected local date';
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

alter function public.submit_daily_response(uuid[], jsonb, date) owner to postgres;
revoke execute on function public.submit_daily_response(uuid[], jsonb, date) from public, anon, authenticated, service_role;
grant execute on function public.submit_daily_response(uuid[], jsonb, date) to authenticated;
