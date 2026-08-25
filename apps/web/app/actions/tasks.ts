"use server";

import { createClient } from "@/utils/supabase/server";
import {
  createTaskSchema,
  listTasksSchema,
  updateTaskStatusSchema,
} from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isProjectMember } from "@/lib/auth";

export type TasksActionResult<T = unknown> = { data?: T; error?: string };

const deleteTaskSchema = z.object({
  taskId: z.string().uuid(),
});

const listMyCardsSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(10),
});

async function resolveRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return (profile?.role as string | null) ?? null;
}

function friendlyRlsError(error: { code?: string; message: string }): string {
  const msg = error.message ?? "";
  const code = error.code ?? "";
  // PostgREST / Postgres RLS denial can surface as 42501, PGRST..., or generic policy message
  if (
    code === "42501" ||
    msg.toLowerCase().includes("row-level security") ||
    msg.toLowerCase().includes("permission denied") ||
    msg.toLowerCase().includes("violates") ||
    msg.toLowerCase().includes("not allowed")
  ) {
    return "Forbidden: not a project member or insufficient permissions (RLS policy blocked this action).";
  }
  return msg;
}

function priorityWeight(p: string): number {
  switch (p) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------
export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  status?: "todo" | "doing" | "done" | "blocked";
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: string | null;
}): Promise<TasksActionResult> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";

  if (!isAdmin) {
    const member = await isProjectMember(parsed.data.projectId, user.id);
    if (!member) return { error: "Forbidden: not a member of this project" };
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      project_id: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status ?? "todo",
      priority: parsed.data.priority ?? "medium",
      assignee_id: parsed.data.assigneeId ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return { error: friendlyRlsError(error) };

  revalidatePath(`/projects/${parsed.data.projectId}/board`);
  revalidatePath(`/admin/projects/${parsed.data.projectId}/board`);
  revalidatePath("/dashboard");
  revalidatePath("/workspace/dashboard");
  return { data };
}

// ---------------------------------------------------------------------------
// updateTaskStatus (drag)
// ---------------------------------------------------------------------------
export async function updateTaskStatus(input: {
  taskId: string;
  status: "todo" | "doing" | "done" | "blocked";
}): Promise<TasksActionResult> {
  const parsed = updateTaskStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";

  // Fetch task to resolve project membership
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("id, project_id")
    .eq("id", parsed.data.taskId)
    .maybeSingle();

  if (fetchError) return { error: friendlyRlsError(fetchError) };
  if (!existing) return { error: "Task not found" };

  if (!isAdmin) {
    const member = await isProjectMember(existing.project_id as string, user.id);
    if (!member) return { error: "Forbidden: not a member of this project" };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.taskId)
    .select()
    .single();

  if (error) return { error: friendlyRlsError(error) };

  const projectId = existing.project_id as string;
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/admin/projects/${projectId}/board`);
  revalidatePath("/dashboard");
  revalidatePath("/workspace/dashboard");
  return { data };
}

// ---------------------------------------------------------------------------
// listTasks scoped by project membership
// ---------------------------------------------------------------------------
export async function listTasks(input?: {
  projectId?: string;
  status?: "todo" | "doing" | "done" | "blocked";
  priority?: "low" | "medium" | "high" | "urgent";
  assigneeId?: string;
  page?: number;
  pageSize?: number;
}): Promise<TasksActionResult> {
  const parsed = listTasksSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  const isAdmin = role === "admin";

  const { projectId, status, priority, assigneeId, page = 1, pageSize = 20 } = parsed.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // If filtering by project, enforce membership for non-admins
  if (projectId) {
    if (!isAdmin) {
      const member = await isProjectMember(projectId, user.id);
      if (!member) return { error: "Forbidden: not a member of this project" };
    }

    let query = supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);
    if (assigneeId) query = query.eq("assignee_id", assigneeId);

    const { data, error, count } = await query;
    if (error) return { error: friendlyRlsError(error) };
    return { data: { rows: data, count, page, pageSize } };
  }

  // No project filter: scope to membership for non-admin
  if (!isAdmin) {
    const { data: memberships, error: memberError } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    if (memberError) return { error: friendlyRlsError(memberError) };
    const projectIds = (memberships ?? []).map((m) => (m as { project_id: string }).project_id);
    if (projectIds.length === 0) {
      return { data: { rows: [], count: 0, page, pageSize } };
    }

    let query = supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);
    if (assigneeId) query = query.eq("assignee_id", assigneeId);

    const { data, error, count } = await query;
    if (error) return { error: friendlyRlsError(error) };
    return { data: { rows: data, count, page, pageSize } };
  }

  // Admin no-filter: global listing
  let query = supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (assigneeId) query = query.eq("assignee_id", assigneeId);

  const { data, error, count } = await query;
  if (error) return { error: friendlyRlsError(error) };
  return { data: { rows: data, count, page, pageSize } };
}

// ---------------------------------------------------------------------------
// listMyCards (assignee = self, ordered by priority top 10)
// ---------------------------------------------------------------------------
export async function listMyCards(input?: {
  page?: number;
  pageSize?: number;
}): Promise<TasksActionResult> {
  const parsed = listMyCardsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const { page = 1, pageSize = 10 } = parsed.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Fetch assignee=self; order by created_at desc then sort by priority weight in JS
  // Apply pagination after priority sort? For top 10 ordered by priority, we fetch a larger window then slice.
  // Simple: fetch up to 100 cards then sort and paginate, or use DB ordering via case if available.
  // Here: fetch up to 50 for reliable priority ordering without complex SQL.
  const fetchSize = Math.min(50, Math.max(pageSize * 3, 20));
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("assignee_id", user.id)
    .order("created_at", { ascending: false })
    .range(0, fetchSize - 1);

  if (error) return { error: friendlyRlsError(error) };

  const all = (data as unknown as Array<{ priority: string; created_at: string }>) ?? [];

  // Stable sort: priority desc, then created_at desc
  const sorted = [...(data as unknown as Array<Record<string, unknown>>)].sort((a, b) => {
    const wa = priorityWeight(a["priority"] as string);
    const wb = priorityWeight(b["priority"] as string);
    if (wb !== wa) return wb - wa;
    const da = new Date(a["created_at"] as string).getTime();
    const db = new Date(b["created_at"] as string).getTime();
    return db - da;
  });

  void all; // keep reference for linter
  const paged = sorted.slice(from, to + 1);

  // Provide count as sorted length (approx; exact count would need extra query)
  // For accuracy, run count query as well
  const { count } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("assignee_id", user.id);

  return { data: { rows: paged, count: count ?? sorted.length, page, pageSize } };
}

// ---------------------------------------------------------------------------
// deleteTask admin-only
// ---------------------------------------------------------------------------
export async function deleteTask(input: { taskId: string } | string): Promise<TasksActionResult> {
  const raw = typeof input === "string" ? { taskId: input } : input;
  const parsed = deleteTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const role = await resolveRole(supabase, user.id);
  if (role !== "admin") return { error: "Forbidden: admin only" };

  // Fetch for revalidation context
  const { data: existing } = await supabase
    .from("tasks")
    .select("project_id")
    .eq("id", parsed.data.taskId)
    .maybeSingle();

  const { error } = await supabase.from("tasks").delete().eq("id", parsed.data.taskId);

  if (error) return { error: friendlyRlsError(error) };

  if (existing?.project_id) {
    revalidatePath(`/projects/${existing.project_id as string}/board`);
    revalidatePath(`/admin/projects/${existing.project_id as string}/board`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/workspace/dashboard");
  revalidatePath("/admin/projects");
  revalidatePath("/projects");
  return { data: { deleted: true } };
}
