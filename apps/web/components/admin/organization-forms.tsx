"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import {
  addProjectMembership,
  addTeamMembership,
  archiveProject,
  archiveTeam,
  createProject,
  createInternalMember,
  createTeam,
  deactivateInternalMember,
  deleteInternalMember,
  reactivateInternalMember,
  removeProjectMembership,
  removeTeamMembership,
  updateInternalMember,
  updateProject,
  updateTeam,
  type OrganizationActionState,
} from "@/app/actions/organization";
import { useDialogClose } from "./dialog";

type Action = (
  state: OrganizationActionState,
  formData: FormData,
) => Promise<OrganizationActionState>;

type StaffOption = {
  id: string;
  label: string;
  role: "admin" | "support_agent" | "superadmin";
};

type TeamOption = { id: string; name: string };
type ProjectOption = { id: string; name: string; teamId: string; teamName?: string };
type InternalMember = {
  id: string;
  email: string;
  role: "admin" | "support_agent" | "superadmin";
};

const initialState: OrganizationActionState = { status: "idle", message: "" };

function MutationForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  compact = false,
  danger = false,
  dialog = false,
  onSuccess,
}: {
  action: Action;
  children: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  compact?: boolean;
  danger?: boolean;
  dialog?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const closeDialog = useDialogClose();

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => onSuccess?.(), 1800);
    return () => window.clearTimeout(timeout);
  }, [onSuccess, state.status]);

  return (
    <form action={formAction} className={`${compact ? "admin-form compact" : "admin-form"}${dialog ? " dialog-form" : ""}`}>
      {children}
      {state.message ? (
        <p
          aria-live="polite"
          className={state.status === "error" ? "action-message error" : "action-message success"}
          ref={state.status === "error" ? errorRef : undefined}
          role={state.status === "error" ? "alert" : "status"}
          tabIndex={state.status === "error" ? -1 : undefined}
        >
          {state.message}
        </p>
      ) : null}
      <div className={dialog ? "dialog-form-footer" : undefined}>
        {dialog ? <button className="secondary-button" disabled={pending} onClick={closeDialog ?? undefined} type="button">Cancelar</button> : null}
        <button
          className={danger ? "secondary-button danger-button" : "primary-button"}
          disabled={pending}
          type="submit"
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

function DescriptionField({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <label>
      <span>Descripción</span>
      <textarea
        defaultValue={defaultValue}
        autoComplete="off"
        maxLength={1000}
        name="description"
        placeholder="Contexto opcional para el equipo…"
        rows={2}
      />
    </label>
  );
}

export function CreateTeamForm({ onSuccess }: { onSuccess?: () => void }) {
  return (
    <MutationForm
      action={createTeam}
      pendingLabel="Creando…"
      submitLabel="Crear equipo"
      dialog
      onSuccess={onSuccess}
    >
      <label>
        <span>Nombre</span>
        <input autoComplete="off" maxLength={100} minLength={2} name="name" required />
      </label>
      <DescriptionField />
    </MutationForm>
  );
}

export function CreateInternalMemberForm({
  allowSuperadmin,
  teams,
  projects,
  onSuccess,
}: {
  allowSuperadmin: boolean;
  teams: TeamOption[];
  projects: ProjectOption[];
  onSuccess?: () => void;
}) {
  return (
    <MutationForm
      action={createInternalMember}
      pendingLabel="Creando…"
      submitLabel="Crear miembro"
      dialog
      onSuccess={onSuccess}
    >
      <p className="muted small-text form-helper">
        El equipo y el proyecto son asignaciones independientes y opcionales.
      </p>
      <div className="form-grid three-up">
        <label>
          <span>Correo electrónico</span>
          <input autoComplete="email" name="email" required spellCheck={false} type="email" />
        </label>
        <label>
          <span>Contraseña</span>
          <input
            autoComplete="new-password"
            maxLength={128}
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
        <label>
          <span>Rol</span>
          <select defaultValue="support_agent" name="role" required>
            <option value="support_agent">Agente de soporte</option>
            <option value="admin">Administrador</option>
            {allowSuperadmin ? <option value="superadmin">Superadmin</option> : null}
          </select>
        </label>
        <label>
          <span>Equipo (opcional)</span>
          <select defaultValue="" name="teamId">
            <option value="">Sin equipo</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Proyecto (opcional)</span>
          <select defaultValue="" name="projectId">
            <option value="">Sin proyecto</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}{project.teamName ? ` · ${project.teamName}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
    </MutationForm>
  );
}

export function EditInternalMemberForm({
  allowSuperadmin,
  member,
  onSuccess,
}: {
  allowSuperadmin: boolean;
  member: InternalMember;
  onSuccess?: () => void;
}) {
  return (
    <MutationForm
      action={updateInternalMember}
      compact
      pendingLabel="Guardando…"
      submitLabel="Guardar cambios"
      dialog
      onSuccess={onSuccess}
    >
      <input name="userId" type="hidden" value={member.id} />
      <label>
        <span>Correo electrónico</span>
        <input autoComplete="email" defaultValue={member.email} name="email" required spellCheck={false} type="email" />
      </label>
      <label>
        <span>Nueva contraseña (opcional)</span>
        <input
          autoComplete="new-password"
          maxLength={128}
          minLength={8}
          name="password"
          placeholder="Dejá vacío para conservarla…"
          type="password"
        />
      </label>
      {member.role === "superadmin" && !allowSuperadmin ? (
        <div className="form-field">
          <span className="form-label">Rol</span>
          <strong>Superadmin</strong>
          <p className="muted small-text">Solo un superadmin puede cambiar este rol.</p>
          <input name="role" type="hidden" value="superadmin" />
        </div>
      ) : (
        <label>
          <span>Rol</span>
          <select defaultValue={member.role} name="role" required>
            <option value="support_agent">Agente de soporte</option>
            <option value="admin">Administrador</option>
            {allowSuperadmin ? <option value="superadmin">Superadmin</option> : null}
          </select>
        </label>
      )}
    </MutationForm>
  );
}

export function DeactivateInternalMemberForm({ userId, onSuccess }: { userId: string; onSuccess?: () => void }) {
  return (
    <MutationForm
      action={deactivateInternalMember}
      compact
      danger
      pendingLabel="Desactivando…"
      submitLabel="Desactivar"
      dialog
      onSuccess={onSuccess}
    >
      <input name="userId" type="hidden" value={userId} />
      <label className="cascade-confirmation">
        <input name="confirmation" required type="checkbox" value="true" />
        <span>Confirmo que esta persona perderá el inicio de sesión y el acceso al sistema.</span>
      </label>
    </MutationForm>
  );
}

export function ReactivateInternalMemberForm({ userId, onSuccess }: { userId: string; onSuccess?: () => void }) {
  return (
    <MutationForm
      action={reactivateInternalMember}
      compact
      pendingLabel="Reactivando…"
      submitLabel="Reactivar"
      dialog
      onSuccess={onSuccess}
    >
      <input name="userId" type="hidden" value={userId} />
    </MutationForm>
  );
}

export function DeleteInternalMemberForm({ userId, onSuccess }: { userId: string; onSuccess?: () => void }) {
  return (
    <MutationForm
      action={deleteInternalMember}
      compact
      danger
      pendingLabel="Eliminando…"
      submitLabel="Eliminar definitivamente"
      dialog
      onSuccess={onSuccess}
    >
      <input name="userId" type="hidden" value={userId} />
      <label className="cascade-confirmation">
        <input name="confirmation" required type="checkbox" value="true" />
        <span>Confirmo que esta acción es permanente y no se puede deshacer.</span>
      </label>
    </MutationForm>
  );
}

export function EditTeamForm({
  team,
  onSuccess,
}: {
  team: { id: string; name: string; description: string | null };
  onSuccess?: () => void;
}) {
  return (
    <MutationForm action={updateTeam} pendingLabel="Guardando…" submitLabel="Guardar equipo" dialog onSuccess={onSuccess}>
      <input name="teamId" type="hidden" value={team.id} />
      <label>
        <span>Nombre del equipo</span>
        <input autoComplete="off" defaultValue={team.name} maxLength={100} minLength={2} name="name" required />
      </label>
      <DescriptionField defaultValue={team.description ?? ""} />
    </MutationForm>
  );
}

export function ArchiveTeamForm({ teamId, onSuccess }: { teamId: string; onSuccess?: () => void }) {
  return (
    <MutationForm
      action={archiveTeam}
      compact
      danger
      pendingLabel="Archivando…"
      submitLabel="Archivar equipo"
      dialog
      onSuccess={onSuccess}
    >
      <input name="teamId" type="hidden" value={teamId} />
      <p className="muted small-text">Primero archivá los proyectos activos de este equipo.</p>
    </MutationForm>
  );
}

export function CreateProjectForm({
  teamId,
  teams,
  onSuccess,
}: {
  teamId?: string;
  teams?: TeamOption[];
  onSuccess?: () => void;
}) {
  return (
    <MutationForm
      action={createProject}
      pendingLabel="Creando…"
      submitLabel="Crear proyecto"
      dialog
      onSuccess={onSuccess}
    >
      {teamId ? (
        <input name="teamId" type="hidden" value={teamId} />
      ) : (
        <label>
          <span>Equipo</span>
          <select defaultValue="" name="teamId" required>
            <option disabled value="">
              Seleccioná un equipo…
            </option>
            {(teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted small-text">
        Las columnas iniciales del flujo se crearán automáticamente.
      </p>
      <label>
        <span>Nombre</span>
        <input autoComplete="off" maxLength={100} minLength={2} name="name" required />
      </label>
      <DescriptionField />
    </MutationForm>
  );
}

export function EditProjectForm({
  project,
  onSuccess,
}: {
  project: { id: string; name: string; description: string | null };
  onSuccess?: () => void;
}) {
  return (
    <MutationForm action={updateProject} pendingLabel="Guardando…" submitLabel="Guardar proyecto" dialog onSuccess={onSuccess}>
      <input name="projectId" type="hidden" value={project.id} />
      <label>
        <span>Nombre del proyecto</span>
        <input
          defaultValue={project.name}
          autoComplete="off"
          maxLength={100}
          minLength={2}
          name="name"
          required
        />
      </label>
      <DescriptionField defaultValue={project.description ?? ""} />
    </MutationForm>
  );
}

export function ArchiveProjectForm({ projectId, onSuccess }: { projectId: string; onSuccess?: () => void }) {
  return (
    <MutationForm
      action={archiveProject}
      compact
      danger
      pendingLabel="Archivando…"
      submitLabel="Archivar proyecto"
      dialog
      onSuccess={onSuccess}
    >
      <input name="projectId" type="hidden" value={projectId} />
      <p className="muted small-text">Archivar no elimina las tareas existentes.</p>
    </MutationForm>
  );
}

export function AddMembershipForm({
  kind,
  resourceId,
  staff,
  onSuccess,
}: {
  kind: "team" | "project";
  resourceId: string;
  staff: StaffOption[];
  onSuccess?: () => void;
}) {
  const action = kind === "team" ? addTeamMembership : addProjectMembership;
  const resourceField = kind === "team" ? "teamId" : "projectId";

  if (staff.length === 0) {
    return <p className="muted small-text">Todas las personas activas ya están asignadas.</p>;
  }

  return (
    <MutationForm action={action} pendingLabel="Agregando…" submitLabel="Agregar integrante" dialog onSuccess={onSuccess}>
      <input name={resourceField} type="hidden" value={resourceId} />
      <label>
        <span>Persona interna</span>
        <select defaultValue="" name="userId" required>
          <option disabled value="">
            Seleccioná una persona…
          </option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.label} · {person.role === "admin" ? "Admin" : person.role === "superadmin" ? "Superadmin" : "Support Agent"}
            </option>
          ))}
        </select>
      </label>
    </MutationForm>
  );
}

export function RemoveMembershipForm({
  kind,
  resourceId,
  userId,
  onSuccess,
}: {
  kind: "team" | "project";
  resourceId: string;
  userId: string;
  onSuccess?: () => void;
}) {
  const action = kind === "team" ? removeTeamMembership : removeProjectMembership;
  const resourceField = kind === "team" ? "teamId" : "projectId";

  return (
    <MutationForm
      action={action}
      danger
      pendingLabel="Quitando…"
      submitLabel="Quitar"
      dialog
      onSuccess={onSuccess}
    >
      <input name={resourceField} type="hidden" value={resourceId} />
      <input name="userId" type="hidden" value={userId} />
      {kind === "project" ? (
        <label className="cascade-confirmation">
          <input name="cascadeAcknowledged" required type="checkbox" value="true" />
          <span>
            Confirmo que quitar el acceso al proyecto también elimina las asignaciones de tareas de esta persona. Las tareas no se eliminan.
          </span>
        </label>
      ) : null}
    </MutationForm>
  );
}
