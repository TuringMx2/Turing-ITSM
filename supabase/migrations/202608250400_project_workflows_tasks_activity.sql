-- Configurable project workflows, collaborative tasks, and append-only activity.

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create table public.project_workflow_columns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  name text not null,
  position integer not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_workflow_columns_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint project_workflow_columns_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint project_workflow_columns_name_check check (
    char_length(btrim(name)) between 1 and 80
  ),
  constraint project_workflow_columns_position_check check (position >= 0),
  unique (project_id, name),
  unique (project_id, position),
  unique (tenant_id, project_id, id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  column_id uuid not null,
  title text not null,
  description text not null,
  priority public.task_priority not null default 'medium',
  due_date date not null,
  position bigint not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint tasks_column_project_fk
    foreign key (tenant_id, project_id, column_id)
    references public.project_workflow_columns (tenant_id, project_id, id)
    on delete restrict,
  constraint tasks_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint tasks_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint tasks_description_check check (
    char_length(btrim(description)) between 1 and 8000
  ),
  constraint tasks_position_check check (position >= 0),
  unique (tenant_id, project_id, id)
);
create table public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  user_id uuid not null,
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  constraint task_assignees_task_project_fk
    foreign key (tenant_id, project_id, task_id)
    references public.tasks (tenant_id, project_id, id)
    on delete cascade,
  constraint task_assignees_project_member_fk
    foreign key (tenant_id, project_id, user_id)
    references public.project_memberships (tenant_id, project_id, user_id)
    on delete cascade,
  constraint task_assignees_actor_tenant_fk
    foreign key (tenant_id, assigned_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (task_id, user_id)
);
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  author_user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint task_comments_task_project_fk
    foreign key (tenant_id, project_id, task_id)
    references public.tasks (tenant_id, project_id, id)
    on delete cascade,
  constraint task_comments_author_tenant_fk
    foreign key (tenant_id, author_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint task_comments_body_check check (
    char_length(btrim(body)) between 1 and 8000
  )
);
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  uploaded_by uuid not null,
  bucket text not null default 'task-attachments',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint task_attachments_task_project_fk
    foreign key (tenant_id, project_id, task_id)
    references public.tasks (tenant_id, project_id, id)
    on delete cascade,
  constraint task_attachments_uploader_tenant_fk
    foreign key (tenant_id, uploaded_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint task_attachments_bucket_check check (bucket = 'task-attachments'),
  constraint task_attachments_file_name_check check (
    char_length(btrim(file_name)) between 1 and 255
  ),
  constraint task_attachments_size_check check (
    size_bytes between 0 and 10485760
  )
);
create table public.task_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  task_id uuid references public.tasks(id) on delete set null,
  actor_user_id uuid,
  actor_role public.app_role,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now(),
  constraint task_activity_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint task_activity_actor_tenant_fk
    foreign key (tenant_id, actor_user_id)
    references public.profiles (tenant_id, id)
    on delete restrict
);
create function private.assert_task_scope_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Task tenant, project, and creator are immutable';
  end if;
  return new;
end;
$$;
create function private.assert_workflow_column_scope_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Workflow column tenant, project, and creator are immutable';
  end if;
  return new;
end;
$$;
create function private.prevent_nonempty_workflow_column_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.tasks t where t.column_id = old.id) then
    raise exception 'A workflow column containing tasks cannot be deleted';
  end if;
  return old;
end;
$$;
create function private.seed_default_project_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_workflow_columns (
    tenant_id, project_id, name, position, created_by
  ) values
    (new.tenant_id, new.id, 'To do', 0, new.created_by),
    (new.tenant_id, new.id, 'In progress', 1, new.created_by),
    (new.tenant_id, new.id, 'Done', 2, new.created_by),
    (new.tenant_id, new.id, 'Blocked', 3, new.created_by);
  return new;
end;
$$;
create function private.record_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_entity_id uuid;
  v_tenant_id uuid;
  v_project_id uuid;
  v_task_id uuid;
begin
  v_entity_id := (v_row ->> 'id')::uuid;
  v_tenant_id := (v_row ->> 'tenant_id')::uuid;
  v_project_id := (v_row ->> 'project_id')::uuid;

  if tg_table_name = 'tasks' then
    if tg_op <> 'DELETE' then
      v_task_id := v_entity_id;
    end if;
  elsif v_row ? 'task_id' then
    v_task_id := (v_row ->> 'task_id')::uuid;
  end if;

  if v_task_id is not null
     and not exists (select 1 from public.tasks t where t.id = v_task_id) then
    v_task_id := null;
  end if;

  insert into public.task_activity (
    tenant_id,
    project_id,
    task_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    v_tenant_id,
    v_project_id,
    v_task_id,
    auth.uid(),
    private.current_role(),
    lower(tg_table_name || '_' || tg_op),
    tg_table_name,
    v_entity_id,
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create function private.prevent_task_activity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Task activity is append-only';
end;
$$;
alter function private.seed_default_project_workflow() owner to postgres;
alter function private.record_task_activity() owner to postgres;
create trigger seed_project_workflow_after_insert
after insert on public.projects
for each row execute function private.seed_default_project_workflow();
create trigger set_project_workflow_columns_updated_at
before update on public.project_workflow_columns
for each row execute function private.set_updated_at();
create trigger assert_workflow_column_scope_immutable
before update on public.project_workflow_columns
for each row execute function private.assert_workflow_column_scope_immutable();
create trigger prevent_nonempty_workflow_column_delete
before delete on public.project_workflow_columns
for each row execute function private.prevent_nonempty_workflow_column_delete();
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function private.set_updated_at();
create trigger assert_task_scope_immutable
before update on public.tasks
for each row execute function private.assert_task_scope_immutable();
create trigger record_workflow_column_activity
after insert or update or delete on public.project_workflow_columns
for each row execute function private.record_task_activity();
create trigger record_task_activity
after insert or update or delete on public.tasks
for each row execute function private.record_task_activity();
create trigger record_task_assignee_activity
after insert or delete on public.task_assignees
for each row execute function private.record_task_activity();
create trigger record_task_comment_activity
after insert on public.task_comments
for each row execute function private.record_task_activity();
create trigger record_task_attachment_activity
after insert or delete on public.task_attachments
for each row execute function private.record_task_activity();
create trigger prevent_task_activity_update_delete
before update or delete on public.task_activity
for each row execute function private.prevent_task_activity_change();
revoke execute on function private.assert_task_scope_immutable() from public;
revoke execute on function private.assert_workflow_column_scope_immutable() from public;
revoke execute on function private.prevent_nonempty_workflow_column_delete() from public;
revoke execute on function private.seed_default_project_workflow() from public;
revoke execute on function private.record_task_activity() from public;
revoke execute on function private.prevent_task_activity_change() from public;
insert into public.project_workflow_columns (
  tenant_id, project_id, name, position, created_by
)
select p.tenant_id, p.id, defaults.name, defaults.position, p.created_by
from public.projects p
cross join (values
  ('To do', 0),
  ('In progress', 1),
  ('Done', 2),
  ('Blocked', 3)
) as defaults(name, position)
where not exists (
  select 1 from public.project_workflow_columns c where c.project_id = p.id
);
create index project_workflow_columns_project_position_idx
  on public.project_workflow_columns (project_id, position);
create index tasks_project_column_position_idx
  on public.tasks (project_id, column_id, position);
create index tasks_due_date_idx on public.tasks (due_date);
create index tasks_priority_idx on public.tasks (priority);
create index task_assignees_user_idx on public.task_assignees (user_id, assigned_at desc);
create index task_comments_task_created_idx on public.task_comments (task_id, created_at);
create index task_attachments_task_created_idx on public.task_attachments (task_id, created_at);
create index task_activity_task_occurred_idx on public.task_activity (task_id, occurred_at);
create index task_activity_project_occurred_idx on public.task_activity (project_id, occurred_at);
alter table public.project_workflow_columns enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_activity enable row level security;
create policy project_workflow_columns_read_scope on public.project_workflow_columns
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy project_workflow_columns_insert_scope on public.project_workflow_columns
for insert to authenticated
with check (
  private.can_manage_project(tenant_id, project_id)
  and created_by = (select auth.uid())
);
create policy project_workflow_columns_update_scope on public.project_workflow_columns
for update to authenticated
using (private.can_manage_project(tenant_id, project_id))
with check (private.can_manage_project(tenant_id, project_id));
create policy project_workflow_columns_delete_scope on public.project_workflow_columns
for delete to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy tasks_read_scope on public.tasks
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy tasks_insert_scope on public.tasks
for insert to authenticated
with check (
  private.can_manage_project(tenant_id, project_id)
  and created_by = (select auth.uid())
);
create policy tasks_update_scope on public.tasks
for update to authenticated
using (private.can_manage_project(tenant_id, project_id))
with check (private.can_manage_project(tenant_id, project_id));
create policy tasks_delete_scope on public.tasks
for delete to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_assignees_read_scope on public.task_assignees
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_assignees_insert_scope on public.task_assignees
for insert to authenticated
with check (
  private.can_manage_project(tenant_id, project_id)
  and assigned_by = (select auth.uid())
);
create policy task_assignees_delete_scope on public.task_assignees
for delete to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_comments_read_scope on public.task_comments
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_comments_insert_scope on public.task_comments
for insert to authenticated
with check (
  private.can_manage_project(tenant_id, project_id)
  and author_user_id = (select auth.uid())
);
create policy task_attachments_read_scope on public.task_attachments
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_attachments_insert_scope on public.task_attachments
for insert to authenticated
with check (
  private.can_manage_project(tenant_id, project_id)
  and uploaded_by = (select auth.uid())
  and bucket = 'task-attachments'
);
create policy task_attachments_delete_scope on public.task_attachments
for delete to authenticated
using (private.can_manage_project(tenant_id, project_id));
create policy task_activity_read_scope on public.task_activity
for select to authenticated
using (private.can_manage_project(tenant_id, project_id));
grant select, insert, update, delete on public.project_workflow_columns to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, delete on public.task_assignees to authenticated;
grant select, insert on public.task_comments to authenticated;
grant select, insert, delete on public.task_attachments to authenticated;
grant select on public.task_activity to authenticated;
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
create policy task_attachment_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.task_attachments a
    where a.storage_path = storage.objects.name
      and private.can_manage_project(a.tenant_id, a.project_id)
  )
);
create policy task_attachment_objects_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.task_attachments a
    where a.storage_path = storage.objects.name
      and a.uploaded_by = (select auth.uid())
      and private.can_manage_project(a.tenant_id, a.project_id)
  )
);
create policy task_attachment_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.task_attachments a
    where a.storage_path = storage.objects.name
      and private.can_manage_project(a.tenant_id, a.project_id)
  )
);
