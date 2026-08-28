import { isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";
import { RolesPermissionsWorkspace } from "./roles-permissions-workspace";

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

export async function RolesPermissionsAdmin() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError || !auth.user) {
    return (
      <section className="card access-denied-card">
        <h1>Unable to load Roles &amp; Permissions</h1>
        <p className="muted">Your session is no longer available. Sign in again.</p>
      </section>
    );
  }

  const { data: actor, error: actorError } = await supabase
    .from("profiles")
    .select("tenant_id, role, status")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (
    actorError ||
    !actor ||
    !isAdmin(actor.role) ||
    actor.status !== "active" ||
    typeof actor.tenant_id !== "string"
  ) {
    return (
      <section className="card access-denied-card">
        <h1>Admin access required</h1>
        <p className="muted">A tenant-scoped admin profile is required to manage teams and projects.</p>
      </section>
    );
  }

  const tenantId = actor.tenant_id;
  const [profilesResult, teamsResult, projectsResult, teamMembersResult, projectMembersResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, role, status")
        .eq("tenant_id", tenantId)
        .in("role", ["admin", "support_agent", "superadmin"])
        .order("full_name"),
      supabase
        .from("teams")
        .select("id, name, description, archived_at")
        .eq("tenant_id", tenantId)
        .order("archived_at", { ascending: true, nullsFirst: true })
        .order("name"),
      supabase
        .from("projects")
        .select("id, team_id, name, description, archived_at")
        .eq("tenant_id", tenantId)
        .order("archived_at", { ascending: true, nullsFirst: true })
        .order("name"),
      supabase.from("team_memberships").select("team_id, user_id").eq("tenant_id", tenantId),
      supabase.from("project_memberships").select("project_id, user_id").eq("tenant_id", tenantId),
    ]);

  if (
    [profilesResult.error, teamsResult.error, projectsResult.error, teamMembersResult.error, projectMembersResult.error].some(
      Boolean,
    )
  ) {
    return (
      <section className="module-page admin-organization-page">
        <div>
          <p className="eyebrow">Admin · Tenant organization</p>
          <h1>Roles &amp; Permissions</h1>
        </div>
        <div className="card">
          <h2>Organization data is unavailable</h2>
          <p className="muted">Refresh the page or try again later.</p>
        </div>
      </section>
    );
  }

  const staff = (profilesResult.data ?? []).flatMap((profile) =>
    isInternalRole(profile.role) ? [{ ...profile, role: profile.role } as StaffProfile] : [],
  );

  return (
    <section className="module-page admin-organization-page">
      <header className="roles-page-header">
        <div>
          <p className="eyebrow">Admin · Control de acceso</p>
          <h1>Roles &amp; Permissions</h1>
          <p className="muted">Administrá quién pertenece a cada equipo y proyecto.</p>
        </div>
        <div className="roles-page-signal" aria-label="Resumen de la organización">
          <span>{staff.length} miembros</span>
          <span>{(teamsResult.data ?? []).length} equipos</span>
          <span>{(projectsResult.data ?? []).length} proyectos</span>
        </div>
      </header>
      <RolesPermissionsWorkspace
        actorRole={actor.role}
        currentUserId={auth.user.id}
        projectMemberships={projectMembersResult.data ?? []}
        projects={(projectsResult.data ?? []) as Project[]}
        staff={staff}
        teamMemberships={teamMembersResult.data ?? []}
        teams={(teamsResult.data ?? []) as Team[]}
      />
    </section>
  );
}
