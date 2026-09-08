-- =========================================================================
-- Fix: 3 eslabones rotos en la propagación de project_id Jira
-- Síntoma: al seleccionar "Rigcore" en ProjectSelector, todos los charts
-- quedan vacíos (0 filas) porque jira_issues.project_id IS NULL para
-- los issues existentes, aunque el admin haya linkeado el board via
-- project_jira_boards durante el Wizard integrate-project.
--
-- Cadena correcta (implementada al pie):
--
--   project_jira_boards (INSERT/UPDATE/DELETE admin via Wizard)
--       │  ← TRIGGER 1 (esta migración): propaga a jira_boards.project_id
--   jira_boards.project_id
--       │  ← TRIGGER 2 (existe): b_i_u_sprints_project_id INSERT-only +
--       │  ← TRIGGER 3 (NUEVO): UPDATE de jira_boards.project_id →
--       │                     actualiza en cascada todos los child rows.
--   jira_sprints.project_id
--       │  ← TRIGGER existe: b_i_u_issues_project_id
--   jira_issues.project_id
--       │  ← TRIGGER existe: b_i_u_changelog_project_id
--   jira_changelog_entries.project_id
--
-- Último paso: BACKFULL (idempotente) que aplique la propagación a
-- project_jira_boards existentes (ej: Rigcore ya linkeado hoy), para que
-- data histórica ya tenga project_id sin re-sincronizar Jira.
-- =========================================================================

set search_path = public;

-- =========================================================================
-- 1) TRIGGER FUNCTION: cuando cambia project_jira_boards,
--    escribimos jira_boards.project_id = project_id (o NULL si DELETE).
--    Esta es la punta de la cadena.
-- =========================================================================

create or replace function private.sync_jira_boards_project_id_from_pjb()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.jira_boards b
       set project_id = new.project_id
     where b.jira_id = new.jira_board_id
       and b.tenant_id = new.tenant_id
       and (b.project_id is distinct from new.project_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.jira_board_id is distinct from old.jira_board_id
       or new.project_id is distinct from old.project_id then
      if old.project_id is not null then
        update public.jira_boards b
           set project_id = null
         where b.jira_id = old.jira_board_id
           and b.tenant_id = old.tenant_id
           and b.project_id = old.project_id;
      end if;
      update public.jira_boards b
         set project_id = new.project_id
       where b.jira_id = new.jira_board_id
         and b.tenant_id = new.tenant_id
         and (b.project_id is distinct from new.project_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    update public.jira_boards b
       set project_id = null
     where b.jira_id = old.jira_board_id
       and b.tenant_id = old.tenant_id
       and b.project_id = old.project_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists a_i_u_d_project_jira_boards_sync on public.project_jira_boards;
create trigger a_i_u_d_project_jira_boards_sync
after insert or update or delete on public.project_jira_boards
for each row execute function private.sync_jira_boards_project_id_from_pjb();

-- =========================================================================
-- 2) TRIGGER FUNCTION: cuando cambia jira_boards.project_id (incluye
--    cambio de NULL a UUID y viceversa, o cambio entre project_ids)
--    propagar en cascada a SPRINTS → ISSUES → CHANGELOG (registros
--    YA EXISTENTES, que no eran tocados por el trigger BEFORE INSERT
--    existente que solo actúa al insertar la fila sprint/issue/changelog).
--
--    NOTA: el trigger de 0800 (b_i_u_sprints_project_id) solo hace
--          "if new.jira_board_id distinct from old" → NO captura el
--          caso en que jira_boards.project_id se actualiza post-hoc
--          (caso Rigcore linkeado después del full-sync).
-- =========================================================================

create or replace function private.cascade_board_project_id_down()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.project_id is not distinct from old.project_id) then
    return new;
  end if;

  update public.jira_sprints s
     set project_id = new.project_id
   where s.jira_board_id = new.jira_id
     and s.tenant_id = new.tenant_id
     and (s.project_id is distinct from new.project_id);

  update public.jira_issues i
     set project_id = new.project_id
   from public.jira_sprints s
  where s.jira_id = i.jira_sprint_id
    and s.tenant_id = i.tenant_id
    and s.jira_board_id = new.jira_id
    and s.tenant_id = new.tenant_id
    and (i.project_id is distinct from new.project_id);

  update public.jira_changelog_entries c
     set project_id = new.project_id
   from public.jira_issues i
  where i.jira_key = c.jira_issue_key
    and i.tenant_id = c.tenant_id
    and i.jira_sprint_id in (select s.jira_id
                               from public.jira_sprints s
                              where s.jira_board_id = new.jira_id
                                and s.tenant_id = new.tenant_id)
    and i.tenant_id = new.tenant_id
    and (c.project_id is distinct from new.project_id);

  return new;
end $$;

drop trigger if exists a_u_jira_boards_project_id_cascade on public.jira_boards;
create trigger a_u_jira_boards_project_id_cascade
after update of project_id on public.jira_boards
for each row execute function private.cascade_board_project_id_down();

-- =========================================================================
-- 3) IDENTICO PERO para GitHub. El mismo bug. Espejamos para no tener
--    que volver a tocar lo mismo cuando el dashboard de GitHub quede
--    segmentado por proyecto. No rompe nada si no se usa (no-op).
-- =========================================================================

create or replace function private.sync_github_repos_project_id_from_pgr()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.github_repos r
       set project_id = new.project_id
     where r.id = new.github_repo_id
       and r.tenant_id = new.tenant_id
       and (r.project_id is distinct from new.project_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.github_repo_id is distinct from old.github_repo_id
       or new.project_id is distinct from old.project_id then
      if old.project_id is not null then
        update public.github_repos r
           set project_id = null
         where r.id = old.github_repo_id
           and r.tenant_id = old.tenant_id
           and r.project_id = old.project_id;
      end if;
      update public.github_repos r
         set project_id = new.project_id
       where r.id = new.github_repo_id
         and r.tenant_id = new.tenant_id
         and (r.project_id is distinct from new.project_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    update public.github_repos r
       set project_id = null
     where r.id = old.github_repo_id
       and r.tenant_id = old.tenant_id
       and r.project_id = old.project_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists a_i_u_d_project_github_repos_sync on public.project_github_repos;
create trigger a_i_u_d_project_github_repos_sync
after insert or update or delete on public.project_github_repos
for each row execute function private.sync_github_repos_project_id_from_pgr();

create or replace function private.cascade_repo_project_id_down()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.project_id is not distinct from old.project_id) then
    return new;
  end if;

  update public.github_commits c
     set project_id = new.project_id
   where c.github_repo_id = new.id
     and c.tenant_id = new.tenant_id
     and (c.project_id is distinct from new.project_id);

  update public.github_repo_activity_daily a
     set project_id = new.project_id
   where a.github_repo_id = new.id
     and a.tenant_id = new.tenant_id
     and (a.project_id is distinct from new.project_id);

  update public.github_pull_requests p
     set project_id = new.project_id
   where p.github_repo_id = new.id
     and p.tenant_id = new.tenant_id
     and (p.project_id is distinct from new.project_id);

  return new;
end $$;

drop trigger if exists a_u_github_repos_project_id_cascade on public.github_repos;
create trigger a_u_github_repos_project_id_cascade
after update of project_id on public.github_repos
for each row execute function private.cascade_repo_project_id_down();

alter function private.sync_jira_boards_project_id_from_pjb() owner to postgres;
alter function private.cascade_board_project_id_down() owner to postgres;
alter function private.sync_github_repos_project_id_from_pgr() owner to postgres;
alter function private.cascade_repo_project_id_down() owner to postgres;

revoke all on function private.sync_jira_boards_project_id_from_pjb() from public;
revoke all on function private.cascade_board_project_id_down() from public;
revoke all on function private.sync_github_repos_project_id_from_pgr() from public;
revoke all on function private.cascade_repo_project_id_down() from public;

-- =========================================================================
-- 4) BACKFILL IDEMPOTENTE para data existente.
--    Caso real: Rigcore ya linkeado hoy en project_jira_boards.
--    Aplicamos la propagación ahora para poblar project_id en
--    jira_boards / jira_sprints / jira_issues / changelog
--    SIN REQUERIR volver a correr el sync Jira completo.
-- =========================================================================

-- (A) jira_boards <- project_jira_boards
update public.jira_boards b
   set project_id = pjb.project_id
  from public.project_jira_boards pjb
 where pjb.jira_board_id = b.jira_id
   and pjb.tenant_id = b.tenant_id
   and (b.project_id is distinct from pjb.project_id);

-- (B) github_repos <- project_github_repos
update public.github_repos r
   set project_id = pgr.project_id
  from public.project_github_repos pgr
 where pgr.github_repo_id = r.id
   and pgr.tenant_id = r.tenant_id
   and (r.project_id is distinct from pgr.project_id);

-- (C) jira_sprints <- jira_boards (ahora jira_boards.project_id esta poblado)
update public.jira_sprints s
   set project_id = b.project_id
  from public.jira_boards b
 where b.jira_id = s.jira_board_id
   and b.tenant_id = s.tenant_id
   and (s.project_id is distinct from b.project_id);

-- (D) jira_issues <- jira_sprints
update public.jira_issues i
   set project_id = s.project_id
  from public.jira_sprints s
 where s.jira_id = i.jira_sprint_id
   and s.tenant_id = i.tenant_id
   and (i.project_id is distinct from s.project_id);

-- (E) jira_changelog_entries <- jira_issues
update public.jira_changelog_entries c
   set project_id = i.project_id
  from public.jira_issues i
 where i.jira_key = c.jira_issue_key
   and i.tenant_id = c.tenant_id
   and (c.project_id is distinct from i.project_id);

-- (F) github_commits / activity / prs  <- github_repos
update public.github_commits c
   set project_id = r.project_id
  from public.github_repos r
 where r.id = c.github_repo_id
   and r.tenant_id = c.tenant_id
   and (c.project_id is distinct from r.project_id);

update public.github_repo_activity_daily a
   set project_id = r.project_id
  from public.github_repos r
 where r.id = a.github_repo_id
   and r.tenant_id = a.tenant_id
   and (a.project_id is distinct from r.project_id);

update public.github_pull_requests p
   set project_id = r.project_id
  from public.github_repos r
 where r.id = p.github_repo_id
   and r.tenant_id = p.tenant_id
   and (p.project_id is distinct from r.project_id);
;
