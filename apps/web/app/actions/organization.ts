"use server";

import {
  createInternalMemberSchema,
  createOrganizationProjectSchema,
  createTeamSchema,
  deactivateInternalMemberSchema,
  deleteInternalMemberSchema,
  internalMemberIdSchema,
  projectIdSchema,
  projectMembershipSchema,
  removeProjectMembershipSchema,
  staffAccessSchema,
  teamIdSchema,
  teamMembershipSchema,
  updateInternalMemberSchema,
  updateOrganizationProjectSchema,
  updateTeamSchema,
} from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { canAssignSuperadmin, isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";

export type OrganizationActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type AdminContext = { tenantId: string; userId: string; role: InternalRole };
type InternalMember = {
  id: string;
  tenant_id: string;
  role: "admin" | "support_agent" | "superadmin";
  status: "active" | "inactive";
  full_name: string;
  email: string;
};

const failure = (message: string): OrganizationActionState => ({
  status: "error",
  message,
});

const success = (message: string): OrganizationActionState => ({
  status: "success",
  message,
});

function fields(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function validationError(): OrganizationActionState {
  return failure("Review the highlighted values and try again.");
}

function databaseError(
  error: { code?: string } | null,
  fallback: string,
): OrganizationActionState {
  if (error?.code === "23505") {
    return failure("That name or assignment already exists.");
  }
  if (error?.code === "23503") {
    return failure("The selected team, project, or staff member is no longer available.");
  }
  if (error?.code === "42501") {
    return failure("You no longer have permission to perform this action.");
  }
  return failure(fallback);
}

function accountDatabaseError(
  error: { code?: string; message?: string } | null,
  fallback: string,
): OrganizationActionState {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("at least one active admin")) {
    return failure("La cuenta no se puede modificar porque el tenant debe conservar al menos un administrador activo.");
  }
  if (error?.code === "42501") {
    return failure("Ya no tenés permiso para administrar esta cuenta.");
  }
  if (error?.code === "23503" || message.includes("foreign key") || message.includes("violates")) {
    return failure("La cuenta tiene registros dependientes que impiden completar esta operación.");
  }
  return failure(fallback);
}

function getSupabaseAdminClient():
  | { client: SupabaseAdminClient; error: null }
  | { client: null; error: string } {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      client: null,
      error:
        "La configuración del servidor está incompleta: verificá la URL de Supabase y SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  return {
    client: createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }),
    error: null,
  };
}

async function rollbackCreatedUser(
  admin: SupabaseAdminClient,
  userId: string,
): Promise<boolean> {
  try {
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId, false);
    if (!authDeleteError) return true;

    const { error: profileDeleteError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileDeleteError) return false;

    const { error: retryAuthDeleteError } = await admin.auth.admin.deleteUser(userId, false);
    return !retryAuthDeleteError;
  } catch {
    return false;
  }
}

function authCreationError(error: { message?: string } | null): string {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("already") || message.includes("exists")) {
    return "Ya existe una cuenta con ese correo electrónico.";
  }
  return "No se pudo crear la cuenta del miembro. Intentá nuevamente.";
}

async function resolveAdminContext(
  supabase: SupabaseClient,
): Promise<{ context: AdminContext | null; error: string | null }> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { context: null, error: "Your session has expired. Sign in again." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role, status")
    .eq("id", auth.user.id)
    .maybeSingle();

  const role = profile && isInternalRole(profile.role) ? profile.role : null;
  if (profileError || !profile || !role || !isAdmin(role) || profile.status !== "active" || typeof profile.tenant_id !== "string") {
    return { context: null, error: "Admin access is required." };
  }

  return {
    context: { tenantId: profile.tenant_id, userId: auth.user.id, role },
    error: null,
  };
}

async function findInternalUser(
  supabase: SupabaseClient,
  context: AdminContext,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("tenant_id", context.tenantId)
    .eq("id", userId)
    .maybeSingle();

  return !error && !!data && isInternalRole(data.role);
}

async function findInternalMember(
  supabase: SupabaseClient,
  context: AdminContext,
  userId: string,
): Promise<{ member: InternalMember | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, tenant_id, role, status, full_name, email")
    .eq("tenant_id", context.tenantId)
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || !isInternalRole(data.role) || !["active", "inactive"].includes(data.status)) {
    return { member: null, error };
  }

  return { member: data as InternalMember, error: null };
}

function validateMemberTarget(
  context: AdminContext,
  member: InternalMember | null,
  targetUserId: string,
): OrganizationActionState | null {
  if (!member || member.tenant_id !== context.tenantId || member.id !== targetUserId) {
    return failure("La cuenta interna no existe en tu tenant o ya no está disponible.");
  }
  return null;
}

function authManagementError(
  error: { code?: string; message?: string } | null,
  fallback: string,
): OrganizationActionState {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("already") || message.includes("exists") || message.includes("duplicate")) {
    return failure("Ya existe una cuenta con ese correo electrónico.");
  }
  if (
    message.includes("foreign key") ||
    message.includes("violates") ||
    message.includes("dependent") ||
    message.includes("storage")
  ) {
    return failure("No se puede eliminar esta cuenta porque tiene registros dependientes. Podés desactivarla en su lugar.");
  }
  return failure(fallback);
}

async function findTeam(
  supabase: SupabaseClient,
  context: AdminContext,
  teamId: string,
  activeOnly = false,
) {
  let query = supabase
    .from("teams")
    .select("id, archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", teamId);
  if (activeOnly) query = query.is("archived_at", null);
  return query.maybeSingle();
}

async function findProject(
  supabase: SupabaseClient,
  context: AdminContext,
  projectId: string,
  activeOnly = false,
) {
  let query = supabase
    .from("projects")
    .select("id, archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", projectId);
  if (activeOnly) query = query.is("archived_at", null);
  return query.maybeSingle();
}

function revalidateOrganization(projectId?: string): void {
  revalidatePath("/workspace/roles-permisos");
  revalidatePath("/workspace/dashboard");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath("/admin/projects");
  if (projectId) {
    revalidatePath(`/projects/${projectId}/board`);
    revalidatePath(`/admin/projects/${projectId}/board`);
  }
}

export async function createTeam(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = createTeamSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { error } = await supabase.from("teams").insert({
    tenant_id: context.tenantId,
    name: parsed.data.name,
    description: parsed.data.description,
    created_by: context.userId,
  });
  if (error) return databaseError(error, "Unable to create the team.");

  revalidateOrganization();
  return success("Team created.");
}

export async function updateTeam(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = updateTeamSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data, error } = await supabase
    .from("teams")
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.teamId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to update the team.");
  if (!data) return failure("The active team was not found.");

  revalidateOrganization();
  return success("Team updated.");
}

export async function archiveTeam(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = teamIdSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data: activeProject, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (projectError) return databaseError(projectError, "Unable to inspect this team.");
  if (activeProject) return failure("Archive this team's active projects first.");

  const { data, error } = await supabase
    .from("teams")
    .update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.teamId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to archive the team.");
  if (!data) return failure("The active team was not found.");

  revalidateOrganization();
  return success("Team archived.");
}

export async function createProject(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = createOrganizationProjectSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data: team, error: teamError } = await findTeam(
    supabase,
    context,
    parsed.data.teamId,
    true,
  );
  if (teamError) return databaseError(teamError, "Unable to inspect the team.");
  if (!team) return failure("Select an active team.");

  const { error } = await supabase.from("projects").insert({
    tenant_id: context.tenantId,
    team_id: parsed.data.teamId,
    name: parsed.data.name,
    description: parsed.data.description,
    created_by: context.userId,
  });
  if (error) return databaseError(error, "Unable to create the project.");

  revalidateOrganization();
  return success("Project created with its default workflow columns.");
}

export async function updateProject(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = updateOrganizationProjectSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data, error } = await supabase
    .from("projects")
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.projectId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to update the project.");
  if (!data) return failure("The active project was not found.");

  revalidateOrganization(parsed.data.projectId);
  return success("Project updated.");
}

export async function archiveProject(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = projectIdSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.projectId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to archive the project.");
  if (!data) return failure("The active project was not found.");

  revalidateOrganization(parsed.data.projectId);
  return success("Project archived. Its tasks were not deleted.");
}

export async function addTeamMembership(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = teamMembershipSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const [{ data: team, error: teamError }, internalUser] = await Promise.all([
    findTeam(supabase, context, parsed.data.teamId, true),
    findInternalUser(supabase, context, parsed.data.userId),
  ]);
  if (teamError) return databaseError(teamError, "Unable to inspect the team.");
  if (!team) return failure("Select an active team.");
  if (!internalUser) return failure("Only tenant admins and support agents can join teams.");

  const { error } = await supabase.from("team_memberships").insert({
    tenant_id: context.tenantId,
    team_id: parsed.data.teamId,
    user_id: parsed.data.userId,
    created_by: context.userId,
  });
  if (error) return databaseError(error, "Unable to add the team membership.");

  revalidateOrganization();
  return success("Team membership added. Project access was not changed.");
}

export async function addStaffAccess(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = staffAccessSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const [{ data: person, error: personError }, { data: team, error: teamError }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, role")
        .eq("tenant_id", context.tenantId)
        .eq("id", parsed.data.userId)
        .maybeSingle(),
      findTeam(supabase, context, parsed.data.teamId, true),
      findProject(supabase, context, parsed.data.projectId, true),
    ]);

  if (personError) return databaseError(personError, "Unable to inspect the staff member.");
  if (teamError) return databaseError(teamError, "Unable to inspect the team.");
  if (projectError) return databaseError(projectError, "Unable to inspect the project.");
  if (!person || !isInternalRole(person.role)) {
    return failure("Only Admin and Support Agent profiles can receive internal access.");
  }
  if (!team) return failure("Select an active team.");
  if (!project) return failure("Select an active project.");

  const [{ error: teamMembershipError }, { error: projectMembershipError }] = await Promise.all([
    supabase.from("team_memberships").upsert(
      {
        tenant_id: context.tenantId,
        team_id: parsed.data.teamId,
        user_id: parsed.data.userId,
        created_by: context.userId,
      },
      { onConflict: "team_id,user_id", ignoreDuplicates: true },
    ),
    supabase.from("project_memberships").upsert(
      {
        tenant_id: context.tenantId,
        project_id: parsed.data.projectId,
        user_id: parsed.data.userId,
        created_by: context.userId,
      },
      { onConflict: "project_id,user_id", ignoreDuplicates: true },
    ),
  ]);

  if (teamMembershipError) {
    return databaseError(teamMembershipError, "Unable to assign the team access.");
  }
  if (projectMembershipError) {
    return databaseError(projectMembershipError, "Unable to assign the project access.");
  }

  revalidateOrganization(parsed.data.projectId);
  return success("Member access assigned to the selected team and project.");
}

export async function createInternalMember(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = createInternalMemberSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return failure("Completá un correo válido, una contraseña de al menos 8 caracteres y un rol válido.");
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador.");

  if (parsed.data.role === "superadmin" && !canAssignSuperadmin(context.role)) {
    return failure("Solo un superadmin activo puede asignar el rol Superadmin.");
  }

  const selectedResources = await Promise.all([
    parsed.data.teamId ? findTeam(supabase, context, parsed.data.teamId, true) : null,
    parsed.data.projectId ? findProject(supabase, context, parsed.data.projectId, true) : null,
  ]);
  const [teamResult, projectResult] = selectedResources;

  if (teamResult?.error) return databaseError(teamResult.error, "No se pudo validar el equipo seleccionado.");
  if (projectResult?.error) return databaseError(projectResult.error, "No se pudo validar el proyecto seleccionado.");
  if (parsed.data.teamId && !teamResult?.data) return failure("El equipo seleccionado no está activo o no existe.");
  if (parsed.data.projectId && !projectResult?.data) {
    return failure("El proyecto seleccionado no está activo o no existe.");
  }

  const adminResult = getSupabaseAdminClient();
  if (!adminResult.client) return failure(adminResult.error);

  let createdUserResult;
  try {
    createdUserResult = await adminResult.client.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
    });
  } catch {
    return failure("No se pudo conectar con el servicio de autenticación. Intentá nuevamente.");
  }

  const { data: createdUser, error: createUserError } = createdUserResult;
  if (createUserError || !createdUser.user) return failure(authCreationError(createUserError));

  const userId = createdUser.user.id;
  const rollback = async (message: string): Promise<OrganizationActionState> => {
    const cleanedUp = await rollbackCreatedUser(adminResult.client, userId);
    return cleanedUp
      ? failure(message)
      : failure(`${message} No se pudo limpiar la cuenta temporal; revisá la configuración de Supabase.`);
  };

  const { error: profileError } = await supabase.rpc("provision_profile", {
    p_user_id: userId,
    p_role: parsed.data.role,
    p_tenant_id: context.tenantId,
    p_full_name: parsed.data.email.slice(0, 160),
    p_email: parsed.data.email,
  });
  if (profileError) return rollback("No se pudo provisionar el perfil del miembro.");

  const [teamMembershipResult, projectMembershipResult] = await Promise.all([
    parsed.data.teamId
      ? supabase.from("team_memberships").insert({
          tenant_id: context.tenantId,
          team_id: parsed.data.teamId,
          user_id: userId,
          created_by: context.userId,
        })
      : Promise.resolve({ error: null }),
    parsed.data.projectId
      ? supabase.from("project_memberships").insert({
          tenant_id: context.tenantId,
          project_id: parsed.data.projectId,
          user_id: userId,
          created_by: context.userId,
        })
      : Promise.resolve({ error: null }),
  ]);

  if (teamMembershipResult.error) return rollback("No se pudo asignar el miembro al equipo seleccionado.");
  if (projectMembershipResult.error) return rollback("No se pudo asignar el miembro al proyecto seleccionado.");

  revalidateOrganization(parsed.data.projectId);
  return success("Miembro creado y acceso configurado correctamente.");
}

export async function updateInternalMember(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = updateInternalMemberSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return failure("Completá un correo válido, una contraseña válida si querés cambiarla y un rol válido.");
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador.");

  const { member, error: memberError } = await findInternalMember(
    supabase,
    context,
    parsed.data.userId,
  );
  if (memberError) return accountDatabaseError(memberError, "No se pudo consultar la cuenta interna.");
  const targetError = validateMemberTarget(context, member, parsed.data.userId);
  if (targetError || !member) return targetError ?? failure("La cuenta interna no está disponible.");

  const roleChanged = parsed.data.role !== member.role;
  const fullNameChanged =
    typeof parsed.data.fullName === "string" && parsed.data.fullName !== member.full_name;
  if (roleChanged && parsed.data.role === "superadmin" && !canAssignSuperadmin(context.role)) {
    return failure("Solo un superadmin activo puede asignar el rol Superadmin.");
  }

  const { data: updatedProfile, error: profileError } = roleChanged
      ? await supabase.rpc("provision_profile", {
          p_user_id: parsed.data.userId,
          p_role: parsed.data.role,
          p_tenant_id: context.tenantId,
          p_full_name: parsed.data.fullName ?? member.full_name,
          p_email: parsed.data.email,
        }).then(({ error }) => ({ data: error ? null : { id: parsed.data.userId }, error }))
    : await supabase
        .from("profiles")
        .update({
          email: parsed.data.email,
          ...(fullNameChanged && parsed.data.fullName
            ? { full_name: parsed.data.fullName }
            : {}),
        })
        .eq("tenant_id", context.tenantId)
        .eq("id", parsed.data.userId)
        .select("id")
        .maybeSingle();
  if (profileError) return accountDatabaseError(profileError, "No se pudo actualizar el perfil del miembro.");
  if (!updatedProfile) return failure("La cuenta interna ya no está disponible.");

  const adminResult = getSupabaseAdminClient();
  if (!adminResult.client) {
    if (roleChanged) {
      await supabase.rpc("provision_profile", {
        p_user_id: parsed.data.userId,
        p_role: member.role,
        p_tenant_id: context.tenantId,
        p_full_name: member.full_name,
        p_email: member.email,
      });
    } else {
      await supabase
        .from("profiles")
        .update({ email: member.email, full_name: member.full_name })
        .eq("tenant_id", context.tenantId)
        .eq("id", parsed.data.userId);
    }
    return failure(adminResult.error);
  }

  const authUpdates: { email: string; password?: string } = { email: parsed.data.email };
  if (parsed.data.password) authUpdates.password = parsed.data.password;

  let authUpdateError: { code?: string; message?: string } | null = null;
  try {
    const result = await adminResult.client.auth.admin.updateUserById(
      parsed.data.userId,
      authUpdates,
    );
    authUpdateError = result.error;
  } catch {
    authUpdateError = { message: "authentication service unavailable" };
  }

  if (authUpdateError) {
    if (roleChanged) {
      await supabase.rpc("provision_profile", {
        p_user_id: parsed.data.userId,
        p_role: member.role,
        p_tenant_id: context.tenantId,
        p_full_name: member.full_name,
        p_email: member.email,
      });
    } else {
      await supabase
        .from("profiles")
        .update({ email: member.email, full_name: member.full_name })
        .eq("tenant_id", context.tenantId)
        .eq("id", parsed.data.userId);
    }
    return authManagementError(
      authUpdateError,
      "No se pudo sincronizar el correo con la cuenta de autenticación. No se guardaron los cambios.",
    );
  }

  revalidateOrganization();
  return success("Cuenta interna actualizada correctamente.");
}

export async function deactivateInternalMember(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = deactivateInternalMemberSchema.safeParse(fields(formData));
  if (!parsed.success) return failure("Confirmá que querés desactivar esta cuenta.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador.");

  if (parsed.data.userId === context.userId) {
    return failure("No podés desactivar tu propia cuenta.");
  }

  const { member, error: memberError } = await findInternalMember(
    supabase,
    context,
    parsed.data.userId,
  );
  if (memberError) return accountDatabaseError(memberError, "No se pudo consultar la cuenta interna.");
  const targetError = validateMemberTarget(context, member, parsed.data.userId);
  if (targetError || !member) return targetError ?? failure("La cuenta interna no está disponible.");
  if (member.status === "inactive") return failure("La cuenta ya está desactivada.");

  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ status: "inactive" })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.userId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (profileError) return accountDatabaseError(profileError, "No se pudo desactivar la cuenta.");
  if (!updatedProfile) return failure("La cuenta ya no está activa o dejó de estar disponible.");

  const adminResult = getSupabaseAdminClient();
  if (!adminResult.client) {
    await supabase
      .from("profiles")
      .update({ status: "active" })
      .eq("tenant_id", context.tenantId)
      .eq("id", parsed.data.userId)
      .eq("status", "inactive");
    return failure(adminResult.error);
  }

  let authError: { code?: string; message?: string } | null = null;
  try {
    const result = await adminResult.client.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: "876000h",
    });
    authError = result.error;
  } catch {
    authError = { message: "authentication service unavailable" };
  }

  if (authError) {
    await supabase
      .from("profiles")
      .update({ status: "active" })
      .eq("tenant_id", context.tenantId)
      .eq("id", parsed.data.userId)
      .eq("status", "inactive");
    return authManagementError(authError, "No se pudo bloquear la cuenta de autenticación.");
  }

  revalidateOrganization();
  return success("Cuenta desactivada. Se bloqueó el inicio de sesión y el acceso actual.");
}

export async function reactivateInternalMember(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = internalMemberIdSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador.");

  const { member, error: memberError } = await findInternalMember(
    supabase,
    context,
    parsed.data.userId,
  );
  if (memberError) return accountDatabaseError(memberError, "No se pudo consultar la cuenta interna.");
  const targetError = validateMemberTarget(context, member, parsed.data.userId);
  if (targetError || !member) return targetError ?? failure("La cuenta interna no está disponible.");
  if (member.status === "active") return failure("La cuenta ya está activa.");

  const adminResult = getSupabaseAdminClient();
  if (!adminResult.client) return failure(adminResult.error);

  let authError: { code?: string; message?: string } | null = null;
  try {
    const result = await adminResult.client.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: "none",
    });
    authError = result.error;
  } catch {
    authError = { message: "authentication service unavailable" };
  }
  if (authError) return authManagementError(authError, "No se pudo reactivar la cuenta de autenticación.");

  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ status: "active" })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.userId)
    .eq("status", "inactive")
    .select("id")
    .maybeSingle();
  if (profileError || !updatedProfile) {
    try {
      await adminResult.client.auth.admin.updateUserById(parsed.data.userId, {
        ban_duration: "876000h",
      });
    } catch {
      // The profile remains inactive, so application and RLS access stay blocked.
    }
    return profileError
      ? accountDatabaseError(profileError, "No se pudo reactivar el perfil de la cuenta.")
      : failure("La cuenta ya no está inactiva o dejó de estar disponible.");
  }

  revalidateOrganization();
  return success("Cuenta reactivada correctamente.");
}

export async function deleteInternalMember(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = deleteInternalMemberSchema.safeParse(fields(formData));
  if (!parsed.success) return failure("Confirmá que querés eliminar definitivamente esta cuenta.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador.");

  if (parsed.data.userId === context.userId) {
    return failure("No podés eliminar tu propia cuenta.");
  }

  const { member, error: memberError } = await findInternalMember(
    supabase,
    context,
    parsed.data.userId,
  );
  if (memberError) return accountDatabaseError(memberError, "No se pudo consultar la cuenta interna.");
  const targetError = validateMemberTarget(context, member, parsed.data.userId);
  if (targetError || !member) return targetError ?? failure("La cuenta interna no está disponible.");

  const adminResult = getSupabaseAdminClient();
  if (!adminResult.client) return failure(adminResult.error);

  let authError: { code?: string; message?: string } | null = null;
  try {
    const result = await adminResult.client.auth.admin.deleteUser(parsed.data.userId, false);
    authError = result.error;
  } catch {
    authError = { message: "authentication service unavailable" };
  }
  if (authError) {
    return authManagementError(
      authError,
      "No se pudo eliminar la cuenta. Si tiene información dependiente, desactivala en su lugar.",
    );
  }

  revalidateOrganization();
  return success("Cuenta eliminada definitivamente.");
}

export async function removeTeamMembership(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = teamMembershipSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data, error } = await supabase
    .from("team_memberships")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId)
    .eq("user_id", parsed.data.userId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to remove the team membership.");
  if (!data) return failure("The team membership was not found.");

  revalidateOrganization();
  return success("Team membership removed. Project access was not changed.");
}

export async function addProjectMembership(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = projectMembershipSchema.safeParse(fields(formData));
  if (!parsed.success) return validationError();

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const [{ data: project, error: projectError }, internalUser] = await Promise.all([
    findProject(supabase, context, parsed.data.projectId, true),
    findInternalUser(supabase, context, parsed.data.userId),
  ]);
  if (projectError) return databaseError(projectError, "Unable to inspect the project.");
  if (!project) return failure("Select an active project.");
  if (!internalUser) return failure("Only tenant admins and support agents can join projects.");

  const { error } = await supabase.from("project_memberships").insert({
    tenant_id: context.tenantId,
    project_id: parsed.data.projectId,
    user_id: parsed.data.userId,
    created_by: context.userId,
  });
  if (error) return databaseError(error, "Unable to add the project membership.");

  revalidateOrganization(parsed.data.projectId);
  return success("Project membership added independently of team membership.");
}

export async function removeProjectMembership(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = removeProjectMembershipSchema.safeParse(fields(formData));
  if (!parsed.success) {
    return failure("Confirm the task-assignment consequence before removing access.");
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Admin access is required.");

  const { data, error } = await supabase
    .from("project_memberships")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", parsed.data.projectId)
    .eq("user_id", parsed.data.userId)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error, "Unable to remove the project membership.");
  if (!data) return failure("The project membership was not found.");

  revalidateOrganization(parsed.data.projectId);
  return success(
    "Project access removed. Related task assignments were removed by database cascade; tasks remain.",
  );
}
