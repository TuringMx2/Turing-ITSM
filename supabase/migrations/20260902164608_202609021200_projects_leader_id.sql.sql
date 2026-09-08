-- Add leader_id FK (ITSM Project Lead) to public.projects.
-- Nullable for existing Rigcore/Lumera projects; new projects via wizard require NOT NULL.

alter table public.projects
  add column leader_id uuid null;

alter table public.projects
  add constraint projects_leader_tenant_fk
    foreign key (tenant_id, leader_id)
    references public.profiles (tenant_id, id)
    on delete restrict;

create index projects_leader_tenant_idx
  on public.projects (tenant_id, leader_id);
;
