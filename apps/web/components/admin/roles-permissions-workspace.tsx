"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { canAssignSuperadmin, roleLabels, type InternalRole } from "@/lib/rbac";
import {
  AddMembershipForm,
  ArchiveProjectForm,
  ArchiveTeamForm,
  CreateInternalMemberForm,
  CreateProjectForm,
  CreateTeamForm,
  DeactivateInternalMemberForm,
  DeleteInternalMemberForm,
  EditInternalMemberForm,
  EditProjectForm,
  EditTeamForm,
  ReactivateInternalMemberForm,
  RemoveMembershipForm,
} from "./organization-forms";
import { Dialog } from "./dialog";

type StaffProfile = {
  id: string;
  full_name: string;
  email: string;
  role: InternalRole;
  status: "active" | "inactive";
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
};

type Project = Team & { team_id: string };
type TeamMembership = { team_id: string; user_id: string };
type ProjectMembership = { project_id: string; user_id: string };
type Tab = "members" | "teams" | "projects";
type MemberFilter = "all" | "active" | "inactive";
type MemberDialog =
  | { kind: "create" }
  | { kind: "edit"; member: StaffProfile }
  | { kind: "deactivate"; member: StaffProfile }
  | { kind: "reactivate"; member: StaffProfile }
  | { kind: "delete"; member: StaffProfile };

const tabs: { value: Tab; label: string }[] = [
  { value: "members", label: "Miembros" },
  { value: "teams", label: "Equipos" },
  { value: "projects", label: "Proyectos" },
];

function MembershipList({
  kind,
  resourceId,
  memberships,
  staff,
  archived = false,
}: {
  kind: "team" | "project";
  resourceId: string;
  memberships: { user_id: string }[];
  staff: StaffProfile[];
  archived?: boolean;
}) {
  const [addingMember, setAddingMember] = useState(false);
  const [removingMember, setRemovingMember] = useState<StaffProfile | null>(null);
  const assignedIds = new Set(memberships.map((membership) => membership.user_id));
  const assigned = staff.filter((person) => assignedIds.has(person.id));
  const available = staff
    .filter((person) => person.status === "active" && !assignedIds.has(person.id))
    .map((person) => ({
      id: person.id,
      label: person.full_name || person.email,
      role: person.role,
    }));

  return (
    <section className="membership-panel resource-members" aria-labelledby={`${kind}-${resourceId}-members`}>
      <div className="section-heading membership-heading">
        <div>
          <span className="section-kicker">Acceso asignado</span>
          <h3 id={`${kind}-${resourceId}-members`}>Integrantes</h3>
          <p className="muted small-text">
            {kind === "team"
              ? "El equipo y sus proyectos se administran por separado."
              : "El acceso a este proyecto no modifica la pertenencia a equipos."}
          </p>
        </div>
        <span className="count-pill" aria-label={`${assigned.length} integrantes`}>{assigned.length}</span>
      </div>

      {assigned.length === 0 ? (
        <p className="empty-state">Todavía no hay integrantes asignados. Sumá una persona activa desde este panel.</p>
      ) : (
        <ul className="member-list">
          {assigned.map((person) => (
            <li key={person.id}>
              <div className="member-list-identity">
                <span className="member-list-avatar" aria-hidden="true">
                  {(person.full_name || person.email).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{person.full_name || person.email}</strong>
                  <small>{person.email} · {roleLabels[person.role]}</small>
                </span>
              </div>
              <span className={`member-status ${person.status}`}>
                {person.status === "active" ? "Activo" : "Inactivo"}
              </span>
              {!archived && person.status === "active" ? (
                <button className="member-remove-button" onClick={() => setRemovingMember(person)} type="button">Quitar</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!archived ? (
        available.length > 0 ? (
          <button className="secondary-button membership-add-button" onClick={() => setAddingMember(true)} type="button">Agregar integrante</button>
        ) : (
          <p className="muted small-text">Todas las personas activas ya están asignadas.</p>
        )
      ) : null}

      <Dialog
        description={`Asigná una persona activa a este ${kind === "team" ? "equipo" : "proyecto"}.`}
        onOpenChange={setAddingMember}
        open={addingMember}
        title="Agregar integrante"
      >
        <AddMembershipForm kind={kind} onSuccess={() => setAddingMember(false)} resourceId={resourceId} staff={available} />
      </Dialog>
      <Dialog
        description={`Quitá el acceso de ${removingMember?.full_name || removingMember?.email || "esta persona"}.`}
        onOpenChange={(open) => { if (!open) setRemovingMember(null); }}
        open={Boolean(removingMember)}
        title="Quitar integrante"
      >
        {removingMember ? <RemoveMembershipForm kind={kind} onSuccess={() => setRemovingMember(null)} resourceId={resourceId} userId={removingMember.id} /> : null}
      </Dialog>
    </section>
  );
}

function ResourceCard({
  label,
  detail,
  meta,
  active,
  archived,
  onClick,
}: {
  label: string;
  detail: string;
  meta: string;
  active: boolean;
  archived: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={`resource-card${active ? " selected" : ""}${archived ? " archived" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="resource-card-top">
        <span className="resource-status">{archived ? "Archivado" : "Activo"}</span>
        <span className="resource-select-label">{active ? "Seleccionado" : "Ver detalle"}</span>
      </span>
      <strong title={label}>{label}</strong>
      <span className="resource-detail-text" title={detail}>{detail}</span>
      <span className="resource-meta">{meta}</span>
    </button>
  );
}

function MembersView({
  actorRole,
  currentUserId,
  staff,
  teams,
  projects,
  teamMemberships,
  projectMemberships,
}: {
  actorRole: InternalRole;
  currentUserId: string;
  staff: StaffProfile[];
  teams: Team[];
  projects: Project[];
  teamMemberships: TeamMembership[];
  projectMemberships: ProjectMembership[];
}) {
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const [memberDialog, setMemberDialog] = useState<MemberDialog | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const activeCount = staff.filter((person) => person.status === "active").length;
  const inactiveCount = staff.length - activeCount;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredStaff = staff.filter((person) => {
    const matchesFilter = filter === "all" || person.status === filter;
    const matchesQuery = !normalizedQuery || `${person.full_name} ${person.email}`.toLocaleLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });

  return (
    <div className="roles-view members-view">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">Directorio interno</p>
          <h2>Miembros</h2>
          <p className="muted">Creá, administrá y revisá el acceso de cada persona.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setMemberDialog({ kind: "create" })}
          type="button"
        >
          Agregar miembro
        </button>
      </div>

      <section className="member-control-bar" aria-label="Filtrar miembros">
        <div className="member-stat-group" aria-label="Resumen de cuentas">
          <span><strong>{staff.length}</strong> total</span>
          <span><strong>{activeCount}</strong> activos</span>
          <span><strong>{inactiveCount}</strong> inactivos</span>
        </div>
        <div className="member-controls">
          <label className="member-search">
            <span className="sr-only">Buscar miembros</span>
            <input
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre o correo…"
              spellCheck={false}
              type="search"
              value={query}
            />
          </label>
          <div className="filter-segment" aria-label="Estado de la cuenta">
            {([
              ["all", "Todos"],
              ["active", "Activos"],
              ["inactive", "Inactivos"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <p aria-live="polite" className="sr-only">
        {filteredStaff.length} {filteredStaff.length === 1 ? "miembro visible" : "miembros visibles"}.
      </p>

      {staff.length === 0 ? (
        <div className="empty-state large-empty-state">
          No hay perfiles internos. Creá el primer miembro para empezar a organizar el acceso.
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="empty-state large-empty-state">
          <strong>No encontramos miembros</strong>
          <span>Probá otro término o restablecé los filtros.</span>
          <button className="secondary-button" onClick={() => { setQuery(""); setFilter("all"); }} type="button">
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="member-directory-grid">
          {filteredStaff.map((person) => {
            const personTeams = teamMemberships
              .filter((membership) => membership.user_id === person.id)
              .map((membership) => teamNames.get(membership.team_id))
              .filter(Boolean);
            const personProjects = projectMemberships
              .filter((membership) => membership.user_id === person.id)
              .map((membership) => projectNames.get(membership.project_id))
              .filter(Boolean);

            return (
              <article className="member-directory-card" key={person.id}>
                <div className="member-avatar" aria-hidden="true">
                  {(person.full_name || person.email).slice(0, 1).toUpperCase()}
                </div>
                <div className="member-directory-identity">
                  <h3>{person.full_name || person.email}</h3>
                  <p className="muted small-text" title={person.email}>{person.email}</p>
                </div>
                <div className="member-badges">
                  <span className="role-pill">{roleLabels[person.role]}</span>
                  <span className={`member-status ${person.status}`}>{person.status === "active" ? "Activo" : "Inactivo"}</span>
                </div>
                <dl className="member-access-summary">
                  <div>
                    <dt>Equipos</dt>
                    <dd>{personTeams.length}</dd>
                  </div>
                  <div>
                    <dt>Proyectos</dt>
                    <dd>{personProjects.length}</dd>
                  </div>
                </dl>
                <div className="member-access-list">
                  <span className="summary-label">Acceso actual</span>
                  <p>{personTeams.join(" · ") || "Sin equipos asignados"}</p>
                  <p>{personProjects.join(" · ") || "Sin proyectos asignados"}</p>
                </div>
                <div className="member-directory-actions">
                  <button className="secondary-button" onClick={() => setMemberDialog({ kind: "edit", member: person })} type="button">Editar cuenta</button>
                  {person.id === currentUserId ? (
                    <p className="muted small-text member-safety-note">Tu cuenta no puede desactivarse ni eliminarse.</p>
                  ) : (
                    <details className="member-action-menu">
                      <summary onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.parentElement?.removeAttribute("open"); }}>Más acciones</summary>
                      <div>
                        {person.status === "active" ? (
                          <button className="secondary-button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setMemberDialog({ kind: "deactivate", member: person }); }} type="button">Desactivar cuenta</button>
                        ) : (
                          <button className="secondary-button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setMemberDialog({ kind: "reactivate", member: person }); }} type="button">Reactivar cuenta</button>
                        )}
                        <button className="secondary-button danger-button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setMemberDialog({ kind: "delete", member: person }); }} type="button">Eliminar definitivamente</button>
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Dialog
        description={memberDialog?.kind === "create" ? "Creá una cuenta y asigná sus accesos iniciales." : memberDialog?.kind === "edit" ? `Modificá el acceso de ${memberDialog.member.full_name || memberDialog.member.email}.` : memberDialog?.kind === "deactivate" ? `${memberDialog.member.full_name || memberDialog.member.email} perderá el acceso al sistema.` : memberDialog?.kind === "reactivate" ? `${memberDialog.member.full_name || memberDialog.member.email} recuperará el acceso al sistema.` : memberDialog?.kind === "delete" ? `Eliminarás permanentemente la cuenta de ${memberDialog.member.full_name || memberDialog.member.email}.` : ""}
        onOpenChange={(open) => { if (!open) setMemberDialog(null); }}
        open={Boolean(memberDialog)}
        title={memberDialog?.kind === "create" ? "Agregar miembro" : memberDialog?.kind === "edit" ? "Editar cuenta" : memberDialog?.kind === "deactivate" ? "Desactivar cuenta" : memberDialog?.kind === "reactivate" ? "Reactivar cuenta" : "Eliminar cuenta"}
      >
        {memberDialog?.kind === "create" ? (
          <CreateInternalMemberForm
            allowSuperadmin={canAssignSuperadmin(actorRole)}
            onSuccess={() => setMemberDialog(null)}
            projects={projects.filter((project) => !project.archived_at).map((project) => ({ id: project.id, name: project.name, teamId: project.team_id, teamName: teamNames.get(project.team_id) ?? "Equipo" }))}
            teams={teams.filter((team) => !team.archived_at)}
          />
        ) : memberDialog?.kind === "edit" ? (
          <EditInternalMemberForm
            allowSuperadmin={canAssignSuperadmin(actorRole)}
            member={memberDialog.member}
            onSuccess={() => setMemberDialog(null)}
          />
        ) : memberDialog?.kind === "deactivate" ? (
          <DeactivateInternalMemberForm onSuccess={() => setMemberDialog(null)} userId={memberDialog.member.id} />
        ) : memberDialog?.kind === "reactivate" ? (
          <ReactivateInternalMemberForm onSuccess={() => setMemberDialog(null)} userId={memberDialog.member.id} />
        ) : memberDialog?.kind === "delete" ? (
          <DeleteInternalMemberForm onSuccess={() => setMemberDialog(null)} userId={memberDialog.member.id} />
        ) : null}
      </Dialog>
    </div>
  );
}

function TeamsView({
  selectedTeamId,
  onSelectTeam,
  staff,
  teams,
  projects,
  memberships,
}: {
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  staff: StaffProfile[];
  teams: Team[];
  projects: Project[];
  memberships: TeamMembership[];
}) {
  const [teamDialog, setTeamDialog] = useState<"create" | "edit" | "archive" | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previousSelection = useRef(selectedTeamId);
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedMembers = memberships.filter((membership) => membership.team_id === selectedTeam?.id);
  const selectedProjects = projects.filter((project) => project.team_id === selectedTeam?.id);

  useEffect(() => {
    if (!selectedTeamId || previousSelection.current === selectedTeamId) return;
    previousSelection.current = selectedTeamId;
    if (window.matchMedia("(max-width: 860px)").matches) {
      requestAnimationFrame(() => {
        detailRef.current?.focus();
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    }
  }, [selectedTeamId]);

  return (
    <div className="roles-view resource-browser">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">Estructura de la compañía</p>
          <h2>Equipos</h2>
          <p className="muted">Elegí un equipo para revisar sus personas y proyectos asociados.</p>
        </div>
        <button className="secondary-button" onClick={() => setTeamDialog("create")} type="button">Crear equipo</button>
      </div>

      {teams.length === 0 ? (
        <div className="empty-state large-empty-state">No hay equipos todavía. Creá el primero para empezar.</div>
      ) : (
        <div className="resource-browser-layout">
          <div className="resource-grid" aria-label="Equipos disponibles">
            {teams.map((team) => (
              <ResourceCard
                active={team.id === selectedTeam?.id}
                archived={Boolean(team.archived_at)}
                detail={team.description || "Sin descripción"}
                key={team.id}
                label={team.name}
                meta={`${memberships.filter((membership) => membership.team_id === team.id).length} integrantes · ${projects.filter((project) => project.team_id === team.id).length} proyectos`}
                onClick={() => onSelectTeam(team.id)}
              />
            ))}
          </div>
          {selectedTeam ? (
            <section className="resource-detail card" aria-labelledby="selected-team-title" ref={detailRef} tabIndex={-1}>
              <div className="resource-detail-heading">
                <div>
                  <p className="eyebrow">{selectedTeam.archived_at ? "Equipo archivado" : "Equipo seleccionado"}</p>
                  <h2 id="selected-team-title">{selectedTeam.name}</h2>
                  <p className="muted">{selectedTeam.description || "Sin descripción."}</p>
                </div>
                <span className="count-pill">{selectedProjects.length} proyectos</span>
              </div>
              {!selectedTeam.archived_at ? (
                <div className="resource-management-actions">
                  <button className="secondary-button" onClick={() => setTeamDialog("edit")} type="button">Editar equipo</button>
                  <button className="secondary-button danger-button" onClick={() => setTeamDialog("archive")} type="button">Archivar equipo</button>
                </div>
              ) : null}
              <MembershipList archived={Boolean(selectedTeam.archived_at)} kind="team" memberships={selectedMembers} resourceId={selectedTeam.id} staff={staff} />
              <div className="related-resources">
                <span className="summary-label">Proyectos de este equipo</span>
                <p>{selectedProjects.map((project) => project.name).join(" · ") || "Sin proyectos"}</p>
              </div>
            </section>
          ) : null}
        </div>
      )}
      <Dialog
        description={teamDialog === "create" ? "Definí el nombre y el contexto del nuevo equipo." : teamDialog === "edit" ? "Actualizá la información visible del equipo." : "Archivá este equipo cuando sus proyectos activos ya estén archivados."}
        onOpenChange={(open) => { if (!open) setTeamDialog(null); }}
        open={Boolean(teamDialog)}
        title={teamDialog === "create" ? "Crear equipo" : teamDialog === "edit" ? "Editar equipo" : "Archivar equipo"}
      >
        {teamDialog === "create" ? <CreateTeamForm onSuccess={() => setTeamDialog(null)} /> : null}
        {teamDialog === "edit" && selectedTeam ? <EditTeamForm onSuccess={() => setTeamDialog(null)} team={selectedTeam} /> : null}
        {teamDialog === "archive" && selectedTeam ? <ArchiveTeamForm onSuccess={() => setTeamDialog(null)} teamId={selectedTeam.id} /> : null}
      </Dialog>
    </div>
  );
}

function ProjectsView({
  selectedProjectId,
  onSelectProject,
  staff,
  teams,
  projects,
  memberships,
}: {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  staff: StaffProfile[];
  teams: Team[];
  projects: Project[];
  memberships: ProjectMembership[];
}) {
  const [projectDialog, setProjectDialog] = useState<"create" | "edit" | "archive" | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previousSelection = useRef(selectedProjectId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedMembers = memberships.filter((membership) => membership.project_id === selectedProject?.id);
  const teamNames = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);

  useEffect(() => {
    if (!selectedProjectId || previousSelection.current === selectedProjectId) return;
    previousSelection.current = selectedProjectId;
    if (window.matchMedia("(max-width: 860px)").matches) {
      requestAnimationFrame(() => {
        detailRef.current?.focus();
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    }
  }, [selectedProjectId]);

  return (
    <div className="roles-view resource-browser">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">Trabajo organizado</p>
          <h2>Proyectos</h2>
          <p className="muted">Elegí un proyecto para revisar quién puede trabajar en él.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!teams.some((team) => !team.archived_at)}
          onClick={() => setProjectDialog("create")}
          title={teams.some((team) => !team.archived_at) ? undefined : "Primero creá un equipo activo"}
          type="button"
        >
          Crear proyecto
        </button>
      </div>

      {!teams.some((team) => !team.archived_at) ? (
        <p className="empty-state compact-empty-state">Creá o reactivá un equipo antes de crear proyectos.</p>
      ) : null}

      {projects.length === 0 ? (
        <div className="empty-state large-empty-state">No hay proyectos todavía. Creá el primero desde este panel.</div>
      ) : (
        <div className="resource-browser-layout">
          <div className="resource-grid" aria-label="Proyectos disponibles">
            {projects.map((project) => (
              <ResourceCard
                active={project.id === selectedProject?.id}
                archived={Boolean(project.archived_at)}
                detail={teamNames.get(project.team_id) ?? "Sin equipo"}
                key={project.id}
                label={project.name}
                meta={`${memberships.filter((membership) => membership.project_id === project.id).length} integrantes`}
                onClick={() => onSelectProject(project.id)}
              />
            ))}
          </div>
          {selectedProject ? (
            <section className="resource-detail card" aria-labelledby="selected-project-title" ref={detailRef} tabIndex={-1}>
              <div className="resource-detail-heading">
                <div>
                  <p className="eyebrow">{selectedProject.archived_at ? "Proyecto archivado" : "Proyecto seleccionado"}</p>
                  <h2 id="selected-project-title">{selectedProject.name}</h2>
                  <p className="muted">Equipo: {teamNames.get(selectedProject.team_id) ?? "Sin equipo"}</p>
                </div>
                <span className="count-pill">{selectedMembers.length} integrantes</span>
              </div>
              {!selectedProject.archived_at ? (
                <div className="resource-management-actions">
                  <button className="secondary-button" onClick={() => setProjectDialog("edit")} type="button">Editar proyecto</button>
                  <button className="secondary-button danger-button" onClick={() => setProjectDialog("archive")} type="button">Archivar proyecto</button>
                </div>
              ) : null}
              <MembershipList archived={Boolean(selectedProject.archived_at)} kind="project" memberships={selectedMembers} resourceId={selectedProject.id} staff={staff} />
            </section>
          ) : null}
        </div>
      )}
      <Dialog
        description={projectDialog === "create" ? "Elegí el equipo y definí la información del nuevo proyecto." : projectDialog === "edit" ? "Actualizá la información visible del proyecto." : "Archivar no elimina las tareas existentes."}
        onOpenChange={(open) => { if (!open) setProjectDialog(null); }}
        open={Boolean(projectDialog)}
        title={projectDialog === "create" ? "Crear proyecto" : projectDialog === "edit" ? "Editar proyecto" : "Archivar proyecto"}
      >
        {projectDialog === "create" ? <CreateProjectForm onSuccess={() => setProjectDialog(null)} teams={teams.filter((team) => !team.archived_at)} /> : null}
        {projectDialog === "edit" && selectedProject ? <EditProjectForm onSuccess={() => setProjectDialog(null)} project={selectedProject} /> : null}
        {projectDialog === "archive" && selectedProject ? <ArchiveProjectForm onSuccess={() => setProjectDialog(null)} projectId={selectedProject.id} /> : null}
      </Dialog>
    </div>
  );
}

export function RolesPermissionsWorkspace({
  actorRole,
  currentUserId,
  staff,
  teams,
  projects,
  teamMemberships,
  projectMemberships,
}: {
  actorRole: InternalRole;
  currentUserId: string;
  staff: StaffProfile[];
  teams: Team[];
  projects: Project[];
  teamMemberships: TeamMembership[];
  projectMemberships: ProjectMembership[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: Tab = requestedTab === "teams" || requestedTab === "projects" ? requestedTab : "members";
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ members: null, teams: null, projects: null });

  function updateWorkspaceState(next: Partial<Record<"tab" | "team" | "project", string>>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function selectTab(tab: Tab) {
    updateWorkspaceState({ tab: tab === "members" ? "" : tab, team: "", project: "" });
  }

  function moveTab(current: Tab, direction: 1 | -1) {
    const currentIndex = tabs.findIndex((tab) => tab.value === current);
    const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length].value;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="roles-workspace">
      <nav className="roles-tabs" role="tablist" aria-label="Secciones de Roles & Permissions">
        {tabs.map(({ value, label }) => {
          const count = value === "members" ? staff.length : value === "teams" ? teams.length : projects.length;
          return (
            <button
              aria-controls={`${value}-panel`}
              aria-selected={activeTab === value}
              className={`roles-tab${activeTab === value ? " active" : ""}`}
              id={`${value}-tab`}
              key={value}
              onClick={() => selectTab(value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveTab(value, 1); }
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveTab(value, -1); }
                if (event.key === "Home") { event.preventDefault(); selectTab("members"); tabRefs.current.members?.focus(); }
                if (event.key === "End") { event.preventDefault(); selectTab("projects"); tabRefs.current.projects?.focus(); }
              }}
              ref={(element) => { tabRefs.current[value] = element; }}
              role="tab"
              tabIndex={activeTab === value ? 0 : -1}
              type="button"
            >
              <span className="roles-tab-label"><strong>{label}</strong></span>
              <span className="roles-tab-count">{count}</span>
            </button>
          );
        })}
      </nav>

      <div aria-labelledby={`${activeTab}-tab`} className="roles-tab-panel" id={`${activeTab}-panel`} role="tabpanel" tabIndex={-1}>
        {activeTab === "members" ? (
          <MembersView actorRole={actorRole} currentUserId={currentUserId} projectMemberships={projectMemberships} projects={projects} staff={staff} teamMemberships={teamMemberships} teams={teams} />
        ) : activeTab === "teams" ? (
          <TeamsView memberships={teamMemberships} onSelectTeam={(team) => updateWorkspaceState({ team })} projects={projects} selectedTeamId={searchParams.get("team")} staff={staff} teams={teams} />
        ) : (
          <ProjectsView memberships={projectMemberships} onSelectProject={(project) => updateWorkspaceState({ project })} projects={projects} selectedProjectId={searchParams.get("project")} staff={staff} teams={teams} />
        )}
      </div>
    </div>
  );
}
