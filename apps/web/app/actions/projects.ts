"use server";

import { createClient } from "@/utils/supabase/server";
import {
  addProjectMembership,
  createProject as createOrganizationProject,
  removeProjectMembership,
} from "@/app/actions/organization";
import { isAdmin, isInternalRole } from "@/lib/rbac";
import { z } from "zod";

export type ProjectsActionResult<T = unknown> = { data?: T; error?: string };

const addMemberSchema = z.object({
  projectId: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  userId: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
});

const listProjectsSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

async function resolveContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !isInternalRole(profile.role) || typeof profile.tenant_id !== "string") {
    return null;
  }
  return { role: profile.role, tenantId: profile.tenant_id };
}

export async function createProject(input: {
  teamId: string;
  name: string;
  description?: string | null;
}): Promise<ProjectsActionResult> {
  const formData = new FormData();
  formData.set("teamId", input.teamId);
  formData.set("name", input.name);
  formData.set("description", input.description ?? "");
  const result = await createOrganizationProject(
    { status: "idle", message: "" },
    formData,
  );
  return result.status === "error"
    ? { error: result.message }
    : { data: { created: true } };
}

export async function listProjects(input?: { page?: number; pageSize?: number }): Promise<ProjectsActionResult> {
  const parsed = listProjectsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const context = await resolveContext(supabase, user.id);
  if (!context) return { error: "Forbidden" };
  const hasAdminAccess = isAdmin(context.role);
  const { page = 1, pageSize = 20 } = parsed.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (hasAdminAccess) {
    const { data, error, count } = await supabase
      .from("projects")
      .select("id, team_id, name, description, created_at, archived_at", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) return { error: "Unable to load projects." };
    return { data: { rows: data, count, page, pageSize } };
  }

  // Non-admin: only projects where user is member
  const { data: memberships, error: memberError } = await supabase
    .from("project_memberships")
    .select("project_id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", user.id);

  if (memberError) return { error: "Unable to load project assignments." };
  const projectIds = (memberships ?? []).map((m) => m.project_id);
  if (projectIds.length === 0) {
    return { data: { rows: [], count: 0, page, pageSize } };
  }

  const { data, error, count } = await supabase
    .from("projects")
    .select("id, team_id, name, description, created_at, archived_at", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .is("archived_at", null)
    .in("id", projectIds)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return { error: "Unable to load projects." };
  return { data: { rows: data, count, page, pageSize } };
}

export async function getProject(projectId: string): Promise<ProjectsActionResult> {
  const parsed = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).safeParse(projectId);
  if (!parsed.success) return { error: "Invalid project id" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const context = await resolveContext(supabase, user.id);
  if (!context) return { error: "Forbidden" };
  const hasAdminAccess = isAdmin(context.role);

  if (!hasAdminAccess) {
    const { data: member } = await supabase
      .from("project_memberships")
      .select("project_id")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", parsed.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return { error: "Forbidden" };
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, team_id, name, description, created_at, archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) return { error: "Unable to load the project." };
  if (!data) return { error: "Project not found" };
  return { data };
}

export async function addMember(input: { projectId: string; userId: string }): Promise<ProjectsActionResult> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const formData = new FormData();
  formData.set("projectId", parsed.data.projectId);
  formData.set("userId", parsed.data.userId);
  const result = await addProjectMembership(
    { status: "idle", message: "" },
    formData,
  );
  return result.status === "error"
    ? { error: result.message }
    : { data: { added: true } };
}

export async function removeMember(input: {
  projectId: string;
  userId: string;
  cascadeAcknowledged?: boolean;
}): Promise<ProjectsActionResult> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  if (!input.cascadeAcknowledged) {
    return { error: "Confirm the task-assignment consequence before removing access." };
  }
  const formData = new FormData();
  formData.set("projectId", parsed.data.projectId);
  formData.set("userId", parsed.data.userId);
  formData.set("cascadeAcknowledged", "true");
  const result = await removeProjectMembership(
    { status: "idle", message: "" },
    formData,
  );
  return result.status === "error"
    ? { error: result.message }
    : { data: { removed: true } };
}

export async function listMembers(projectId: string): Promise<ProjectsActionResult> {
  const parsed = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).safeParse(projectId);
  if (!parsed.success) return { error: "Invalid project id" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const context = await resolveContext(supabase, user.id);
  if (!context) return { error: "Forbidden" };
  const hasAdminAccess = isAdmin(context.role);

  if (!hasAdminAccess) {
    const { data: member } = await supabase
      .from("project_memberships")
      .select("project_id")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", parsed.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return { error: "Forbidden" };
  }

  const { data, error } = await supabase
    .from("project_memberships")
    .select("user_id, created_at")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", parsed.data)
    .order("created_at", { ascending: true });

  if (error) return { error: "Unable to load project memberships." };
  return { data };
}
