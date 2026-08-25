"use server";

import { createClient } from "@/utils/supabase/server";
import { createProjectSchema } from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ProjectsActionResult<T = unknown> = { data?: T; error?: string };

const addMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
});

const listProjectsSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

async function resolveRole(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return profile?.role ?? null;
}

export async function createProject(input: { name: string; description?: string | null }): Promise<ProjectsActionResult> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  if (role !== "admin") return { error: "Forbidden: admin only" };

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Auto-add creator as member for convenience (optional, admin can still list all)
  await supabase.from("project_members").insert({ project_id: data.id, user_id: user.id });

  revalidatePath("/admin/projects");
  revalidatePath("/projects");
  return { data };
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

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";
  const { page = 1, pageSize = 20 } = parsed.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (isAdmin) {
    const { data, error, count } = await supabase
      .from("projects")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) return { error: error.message };
    return { data: { rows: data, count, page, pageSize } };
  }

  // Non-admin: only projects where user is member
  const { data: memberships, error: memberError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);

  if (memberError) return { error: memberError.message };
  const projectIds = (memberships ?? []).map((m) => m.project_id);
  if (projectIds.length === 0) {
    return { data: { rows: [], count: 0, page, pageSize } };
  }

  const { data, error, count } = await supabase
    .from("projects")
    .select("*", { count: "exact" })
    .in("id", projectIds)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return { error: error.message };
  return { data: { rows: data, count, page, pageSize } };
}

export async function getProject(projectId: string): Promise<ProjectsActionResult> {
  const parsed = z.string().uuid().safeParse(projectId);
  if (!parsed.success) return { error: "Invalid project id" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";

  if (!isAdmin) {
    const { data: member } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return { error: "Forbidden" };
  }

  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error) return { error: error.message };
  return { data };
}

export async function addMember(input: { projectId: string; userId: string }): Promise<ProjectsActionResult> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  if (role !== "admin") return { error: "Forbidden: admin only" };

  // Verify project exists
  const { data: project, error: projectError } = await supabase.from("projects").select("id").eq("id", parsed.data.projectId).maybeSingle();
  if (projectError) return { error: projectError.message };
  if (!project) return { error: "Project not found" };

  const { data, error } = await supabase
    .from("project_members")
    .insert({ project_id: parsed.data.projectId, user_id: parsed.data.userId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { error: "User is already a member" };
    if (error.code === "23503") return { error: "Invalid user or project" };
    return { error: error.message };
  }

  revalidatePath(`/admin/projects/${parsed.data.projectId}/board`);
  revalidatePath("/admin/projects");
  revalidatePath("/projects");
  return { data };
}

export async function removeMember(input: { projectId: string; userId: string }): Promise<ProjectsActionResult> {
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, auth.user.id);
  if (role !== "admin") return { error: "Forbidden: admin only" };

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", parsed.data.projectId)
    .eq("user_id", parsed.data.userId);

  if (error) return { error: error.message };
  revalidatePath(`/admin/projects/${parsed.data.projectId}/board`);
  revalidatePath("/admin/projects");
  revalidatePath("/projects");
  return { data: { removed: true } };
}

export async function listMembers(projectId: string): Promise<ProjectsActionResult> {
  const parsed = z.string().uuid().safeParse(projectId);
  if (!parsed.success) return { error: "Invalid project id" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";

  if (!isAdmin) {
    const { data: member } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return { error: "Forbidden" };
  }

  const { data, error } = await supabase.from("project_members").select("*").eq("project_id", projectId).order("created_at", { ascending: true });

  if (error) return { error: error.message };
  return { data };
}
