"use server";

import {
  createTaskCommentSchema,
  createBoardTaskSchema,
  createWorkflowColumnSchema,
  moveTaskSchema,
  renameWorkflowColumnSchema,
  reorderWorkflowColumnSchema,
  setTaskCurrentSprintSchema,
  taskAttachmentIdSchema,
  taskAttachmentMetadataSchema,
  taskIdInputSchema,
  updateBoardTaskSchema,
  workflowColumnIdSchema,
} from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import type { TaskEstimateUnit } from "@/lib/task-estimate";
import { createClient } from "@/utils/supabase/server";

export type TasksActionResult<T = unknown> = { data?: T; error?: string };

export type BoardColumn = {
  id: string;
  project_id: string;
  name: string;
  position: number;
};

export type ProjectMemberOption = {
  id: string;
  full_name: string;
  email: string;
};

export type BoardTask = {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimate_quantity: number | null;
  estimate_unit: TaskEstimateUnit | null;
  is_current_sprint: boolean;
  position: number;
  assignee_ids: string[];
  assignees: ProjectMemberOption[];
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TaskDetail = {
  task: BoardTask;
  comments: Array<{
    id: string;
    body: string;
    author_user_id: string;
    author_name: string;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number;
    uploaded_by: string;
    uploader_name: string;
    created_at: string;
  }>;
  activity: Array<{
    id: string;
    action: string;
    entity_type: string;
    actor_user_id: string | null;
    actor_name: string;
    occurred_at: string;
  }>;
};

export type MyCardRow = {
  id: string;
  project_id: string;
  column_id: string;
  column_name: string;
  title: string;
  description: string;
  priority: BoardTask["priority"];
  estimate_quantity: number | null;
  estimate_unit: TaskEstimateUnit | null;
  created_at: string;
};

export type MyCardsPage = {
  rows: MyCardRow[];
  count: number;
  page: number;
  pageSize: number;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type Actor = { userId: string; tenantId: string; role: InternalRole };
type ProjectAccess = Actor & { projectId: string; archivedAt: string | null };
type TaskAccess = ProjectAccess & {
  task: {
    id: string;
    project_id: string;
    column_id: string;
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
    estimate_quantity: number | null;
    estimate_unit: TaskEstimateUnit | null;
    is_current_sprint: boolean;
    position: number;
    created_by: string;
    created_at: string;
    updated_at: string;
  };
};

const listMyCardsSchema = z.object({
  page: z.number().int().min(1).max(21_474_836).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(10),
});

const myCardsRpcPayloadSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      project_id: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      column_id: z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      column_name: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.enum(["low", "medium", "high", "urgent"]),
      estimate_quantity: z.number().nullable(),
      estimate_unit: z.enum(["hours", "days"]).nullable(),
      created_at: z.string(),
    }),
  ),
  count: z.number().int().nonnegative(),
});

const TASK_POSITION_STEP = 1_048_576;

function safeDatabaseError(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("active project access denied") || message.includes("archived project")) {
    return "Archived projects are read-only.";
  }
  if (error.code === "42501" || message.includes("row-level security")) {
    return "You no longer have access to this project.";
  }
  if (error.code === "23503") {
    return "A selected task, column, or project member is no longer available.";
  }
  if (error.code === "23505") {
    return "That name or assignment already exists.";
  }
  if (message.includes("workflow column containing tasks")) {
    return "Move or delete every task in this column before deleting it.";
  }
  return fallback;
}

function validationError(): string {
  return "Review the submitted values and try again.";
}

function archivedProjectWriteError(access: ProjectAccess): string | undefined {
  return access.archivedAt ? "Archived projects are read-only." : undefined;
}

async function resolveActor(supabase: SupabaseClient): Promise<TasksActionResult<Actor>> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { error: "Your session has expired. Sign in again." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    typeof profile.tenant_id !== "string" ||
    !isInternalRole(profile.role)
  ) {
    return { error: "An internal tenant profile is required." };
  }

  return {
    data: { userId: auth.user.id, tenantId: profile.tenant_id, role: profile.role },
  };
}

async function resolveProjectAccess(
  supabase: SupabaseClient,
  projectId: string,
): Promise<TasksActionResult<ProjectAccess>> {
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const actor = actorResult.data;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, archived_at")
    .eq("tenant_id", actor.tenantId)
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return { error: safeDatabaseError(projectError, "Unable to verify the project.") };
  if (!project) return { error: "Project not found or access denied." };

  if (!isAdmin(actor.role)) {
    const { data: membership, error: membershipError } = await supabase
      .from("project_memberships")
      .select("id")
      .eq("tenant_id", actor.tenantId)
      .eq("project_id", projectId)
      .eq("user_id", actor.userId)
      .maybeSingle();
    if (membershipError) {
      return { error: safeDatabaseError(membershipError, "Unable to verify project access.") };
    }
    if (!membership) return { error: "Project membership is required." };
  }

  return { data: { ...actor, projectId, archivedAt: project.archived_at } };
}

async function resolveTaskAccess(
  supabase: SupabaseClient,
  taskId: string,
): Promise<TasksActionResult<TaskAccess>> {
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const actor = actorResult.data;

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(
      "id, project_id, column_id, title, description, priority, estimate_quantity, estimate_unit, is_current_sprint, position, created_by, created_at, updated_at",
    )
    .eq("tenant_id", actor.tenantId)
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) return { error: safeDatabaseError(taskError, "Unable to verify the task.") };
  if (!task) return { error: "Task not found or access denied." };

  const projectResult = await resolveProjectAccess(supabase, task.project_id);
  if (!projectResult.data) return { error: projectResult.error };
  return { data: { ...projectResult.data, task: task as TaskAccess["task"] } };
}

async function verifyColumn(
  supabase: SupabaseClient,
  access: ProjectAccess,
  columnId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("project_workflow_columns")
    .select("id")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", columnId)
    .maybeSingle();
  return !error && !!data;
}

async function replaceAssignees(
  supabase: SupabaseClient,
  taskId: string,
  desiredIds: string[],
): Promise<TasksActionResult> {
  const { error } = await supabase.rpc("replace_task_assignees", {
    p_task_id: taskId,
    p_assignee_ids: uniqueIds(desiredIds),
  });
  if (error) return { error: safeDatabaseError(error, "Unable to replace task assignments.") };

  return { data: { updated: true } };
}

function revalidateTaskPaths(projectId: string): void {
  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/admin/projects/${projectId}/board`);
  revalidatePath("/projects");
  revalidatePath("/admin/projects");
  revalidatePath("/workspace/roles-permisos");
  revalidatePath("/dashboard");
  revalidatePath("/workspace/dashboard");
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function loadMemberOptions(
  supabase: SupabaseClient,
  access: ProjectAccess,
): Promise<TasksActionResult<ProjectMemberOption[]>> {
  const { data: memberships, error: membershipError } = await supabase
    .from("project_memberships")
    .select("user_id")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId);
  if (membershipError) return { error: "Unable to load project members." };
  const userIds = [...new Set((memberships ?? []).map((row) => row.user_id))];
  if (userIds.length === 0) return { data: [] };

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("tenant_id", access.tenantId)
    .in("id", userIds)
    .order("full_name");
  if (profileError) return { error: "Unable to load project member profiles." };
  return { data: (profiles ?? []) as ProjectMemberOption[] };
}

export async function getTaskBoard(
  projectId: string,
): Promise<
  TasksActionResult<{
    columns: BoardColumn[];
    tasks: BoardTask[];
    allTasks: BoardTask[];
    members: ProjectMemberOption[];
    readOnly: boolean;
  }>
> {
  const parsed = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).safeParse(projectId);
  if (!parsed.success) return { error: "Invalid project identifier." };

  const supabase = await createClient();
  const accessResult = await resolveProjectAccess(supabase, parsed.data);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;

  const [columnsResult, tasksResult, assigneesResult, membersResult] = await Promise.all([
    supabase
      .from("project_workflow_columns")
      .select("id, project_id, name, position")
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .order("position")
      .order("created_at"),
    supabase
      .from("tasks")
      .select(
        "id, project_id, column_id, title, description, priority, estimate_quantity, estimate_unit, is_current_sprint, position, created_by, created_at, updated_at",
      )
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .order("position")
      .order("created_at"),
    supabase
      .from("task_assignees")
      .select("task_id, user_id")
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId),
    loadMemberOptions(supabase, access),
  ]);

  if (columnsResult.error || tasksResult.error || assigneesResult.error || !membersResult.data) {
    return { error: membersResult.error ?? "Unable to load the project board." };
  }

  const members = membersResult.data;
  const memberById = new Map(members.map((member) => [member.id, member]));
  const assigneesByTask = new Map<string, string[]>();
  for (const assignment of assigneesResult.data ?? []) {
    const ids = assigneesByTask.get(assignment.task_id) ?? [];
    ids.push(assignment.user_id);
    assigneesByTask.set(assignment.task_id, ids);
  }

  const allTasks = (tasksResult.data ?? []).map((task) => {
    const assigneeIds = assigneesByTask.get(task.id) ?? [];
    return {
      ...task,
      position: Number(task.position),
      assignee_ids: assigneeIds,
      assignees: assigneeIds.flatMap((id) => {
        const member = memberById.get(id);
        return member ? [member] : [];
      }),
    } as BoardTask;
  });

  return {
    data: {
      columns: (columnsResult.data ?? []).map((column) => ({
        ...column,
        position: Number(column.position),
      })) as BoardColumn[],
      tasks: allTasks.filter((task) => task.is_current_sprint),
      allTasks,
      members,
      readOnly: !!access.archivedAt,
    },
  };
}

export async function createTask(input: {
  projectId: string;
  columnId: string;
  isCurrentSprint: boolean;
  title: string;
  description: string;
  estimateQuantity: string;
  estimateUnit: TaskEstimateUnit;
  priority: "low" | "medium" | "high" | "urgent";
  assigneeIds: string[];
}): Promise<TasksActionResult<BoardTask>> {
  const parsed = createBoardTaskSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveProjectAccess(supabase, parsed.data.projectId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const assigneeIds = uniqueIds(parsed.data.assigneeIds);
  const columnValid = await verifyColumn(supabase, access, parsed.data.columnId);
  if (!columnValid) return { error: "Select a column from this project." };

  const { data: lastTask } = await supabase
    .from("tasks")
    .select("position")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("column_id", parsed.data.columnId)
    .eq("is_current_sprint", parsed.data.isCurrentSprint)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = lastTask ? Number(lastTask.position) + TASK_POSITION_STEP : TASK_POSITION_STEP;

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      tenant_id: access.tenantId,
      project_id: access.projectId,
      column_id: parsed.data.columnId,
      title: parsed.data.title,
      description: parsed.data.description,
      estimate_quantity: parsed.data.estimateQuantity,
      estimate_unit: parsed.data.estimateUnit,
      is_current_sprint: parsed.data.isCurrentSprint,
      priority: parsed.data.priority,
      position,
      created_by: access.userId,
    })
    .select(
      "id, project_id, column_id, title, description, priority, estimate_quantity, estimate_unit, is_current_sprint, position, created_by, created_at, updated_at",
    )
    .single();
  if (taskError || !task) {
    return { error: safeDatabaseError(taskError ?? {}, "Unable to create the task.") };
  }

  const assignmentResult = await replaceAssignees(supabase, task.id, assigneeIds);
  if (assignmentResult.error) {
    const { error: rollbackError } = await supabase
      .from("tasks")
      .delete()
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("id", task.id);
    return {
      error: rollbackError
        ? "Task assignment failed and task creation could not be fully rolled back."
        : assignmentResult.error,
    };
  }

  const memberResult = await loadMemberOptions(supabase, access);
  const memberById = new Map((memberResult.data ?? []).map((member) => [member.id, member]));
  revalidateTaskPaths(access.projectId);
  return {
    data: {
      ...task,
      position: Number(task.position),
      assignee_ids: assigneeIds,
      assignees: assigneeIds.flatMap((id) => {
        const member = memberById.get(id);
        return member ? [member] : [];
      }),
    } as BoardTask,
  };
}

export async function updateTask(input: {
  taskId: string;
  columnId: string;
  title: string;
  description: string;
  estimateQuantity: string;
  estimateUnit: TaskEstimateUnit;
  priority: "low" | "medium" | "high" | "urgent";
  assigneeIds: string[];
}): Promise<TasksActionResult> {
  const parsed = updateBoardTaskSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const assigneeIds = uniqueIds(parsed.data.assigneeIds);
  const columnValid = await verifyColumn(supabase, access, parsed.data.columnId);
  if (!columnValid) return { error: "Select a column from this project." };

  let position = access.task.position;
  if (parsed.data.columnId !== access.task.column_id) {
    const { data: lastTask } = await supabase
      .from("tasks")
      .select("position")
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("column_id", parsed.data.columnId)
      .eq("is_current_sprint", access.task.is_current_sprint)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    position = lastTask
      ? Number(lastTask.position) + TASK_POSITION_STEP
      : TASK_POSITION_STEP;
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      column_id: parsed.data.columnId,
      title: parsed.data.title,
      description: parsed.data.description,
      estimate_quantity: parsed.data.estimateQuantity,
      estimate_unit: parsed.data.estimateUnit,
      priority: parsed.data.priority,
      position,
    })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.task.id);
  if (updateError) return { error: safeDatabaseError(updateError, "Unable to update the task.") };

  const assignmentResult = await replaceAssignees(supabase, access.task.id, assigneeIds);
  if (assignmentResult.error) {
    const { error: rollbackError } = await supabase
      .from("tasks")
      .update({
        column_id: access.task.column_id,
        title: access.task.title,
        description: access.task.description,
        estimate_quantity: access.task.estimate_quantity,
        estimate_unit: access.task.estimate_unit,
        priority: access.task.priority,
        position: access.task.position,
      })
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("id", access.task.id);
    return {
      error: rollbackError
        ? "Task assignments could not be replaced and the task field update could not be rolled back. Refresh before editing again."
        : assignmentResult.error,
    };
  }

  revalidateTaskPaths(access.projectId);
  return { data: { updated: true } };
}

export async function moveTask(input: {
  taskId: string;
  targetColumnId: string;
  targetIndex: number;
}): Promise<TasksActionResult> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  if (!access.task.is_current_sprint) {
    return { error: "Add this task to the current sprint before moving it on the board." };
  }
  if (!(await verifyColumn(supabase, access, parsed.data.targetColumnId))) {
    return { error: "Select a column from this project." };
  }

  const { data: rows, error: rowsError } = await supabase
    .from("tasks")
    .select("id, column_id, position, updated_at, created_at")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("is_current_sprint", true)
    .order("position")
    .order("updated_at", { ascending: false })
    .order("created_at");
  if (rowsError) return { error: "Unable to inspect task order." };

  const target = (rows ?? []).filter(
    (row) => row.column_id === parsed.data.targetColumnId && row.id !== access.task.id,
  );
  const targetIndex = Math.min(parsed.data.targetIndex, target.length);
  const previousPosition = targetIndex > 0 ? Number(target[targetIndex - 1].position) : null;
  const nextPosition = targetIndex < target.length ? Number(target[targetIndex].position) : null;
  const needsRebalance =
    (previousPosition === null && nextPosition === 0) ||
    (previousPosition !== null &&
      nextPosition !== null &&
      nextPosition - previousPosition <= 1);

  if (needsRebalance) {
    const original = new Map(
      (rows ?? []).map((row) => [
        row.id,
        { columnId: row.column_id, position: Number(row.position) },
      ]),
    );
    const desiredOrder = target.map((row) => row.id);
    desiredOrder.splice(targetIndex, 0, access.task.id);
    const desired = desiredOrder.map((id, index) => ({
      id,
      columnId: parsed.data.targetColumnId,
      position: (index + 1) * TASK_POSITION_STEP,
    }));
    if (desired.some((row) => !Number.isSafeInteger(row.position))) {
      return { error: "This task order is too large to update safely." };
    }
    if (desired.some((row) => !original.has(row.id))) {
      return { error: "A task disappeared while its order was being updated." };
    }

    const applied: typeof desired = [];
    for (const row of desired) {
      const before = original.get(row.id)!;
      if (before.columnId === row.columnId && before.position === row.position) continue;
      const { data: updated, error } = await supabase
        .from("tasks")
        .update({ column_id: row.columnId, position: row.position })
        .eq("tenant_id", access.tenantId)
        .eq("project_id", access.projectId)
        .eq("id", row.id)
        .eq("is_current_sprint", true)
        .eq("column_id", before.columnId)
        .eq("position", before.position)
        .select("id")
        .maybeSingle();
      if (error || !updated) {
        let rollbackFailed = false;
        for (const appliedRow of applied.reverse()) {
          const appliedBefore = original.get(appliedRow.id);
          if (!appliedBefore) continue;
          const { error: rollbackError } = await supabase
            .from("tasks")
            .update({
              column_id: appliedBefore.columnId,
              position: appliedBefore.position,
            })
            .eq("tenant_id", access.tenantId)
            .eq("project_id", access.projectId)
            .eq("id", appliedRow.id)
            .eq("is_current_sprint", true)
            .eq("column_id", appliedRow.columnId)
            .eq("position", appliedRow.position);
          rollbackFailed ||= !!rollbackError;
        }
        return {
          error: rollbackFailed
            ? "Task reordering failed and could not be fully restored. Refresh before trying again."
            : "The task order changed. Refresh and try again.",
        };
      }
      applied.push(row);
    }

    revalidateTaskPaths(access.projectId);
    return { data: { moved: true } };
  }

  let position = TASK_POSITION_STEP;
  if (previousPosition !== null && nextPosition !== null) {
    position =
      nextPosition - previousPosition > 1
        ? Math.floor((previousPosition + nextPosition) / 2)
        : nextPosition;
  } else if (previousPosition !== null) {
    position = previousPosition + TASK_POSITION_STEP;
  } else if (nextPosition !== null) {
    position = nextPosition > 0 ? Math.floor(nextPosition / 2) : 0;
  }
  if (!Number.isSafeInteger(position) || position < 0) {
    return { error: "This task order is too large to update safely." };
  }

  const { data: moved, error: moveError } = await supabase
    .from("tasks")
    .update({ column_id: parsed.data.targetColumnId, position })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.task.id)
    .eq("is_current_sprint", true)
    .eq("column_id", access.task.column_id)
    .eq("position", access.task.position)
    .select("id")
    .maybeSingle();
  if (moveError) return { error: safeDatabaseError(moveError, "Unable to persist the task order.") };
  if (!moved) return { error: "The task changed while it was being moved. Refresh and try again." };

  revalidateTaskPaths(access.projectId);
  return { data: { moved: true } };
}

export async function setTaskCurrentSprint(input: {
  taskId: string;
  isCurrentSprint: boolean;
}): Promise<TasksActionResult> {
  const parsed = setTaskCurrentSprintSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  if (access.task.is_current_sprint === parsed.data.isCurrentSprint) {
    return { data: { updated: true } };
  }

  let position = access.task.position;
  if (parsed.data.isCurrentSprint) {
    const { data: lastTask, error: lastTaskError } = await supabase
      .from("tasks")
      .select("position")
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("column_id", access.task.column_id)
      .eq("is_current_sprint", true)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastTaskError) return { error: "Unable to prepare the current sprint." };
    position = lastTask ? Number(lastTask.position) + TASK_POSITION_STEP : TASK_POSITION_STEP;
  }

  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update({ is_current_sprint: parsed.data.isCurrentSprint, position })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.task.id)
    .eq("is_current_sprint", access.task.is_current_sprint)
    .select("id")
    .maybeSingle();
  if (updateError) return { error: safeDatabaseError(updateError, "Unable to update the sprint.") };
  if (!updated) return { error: "The task changed while its sprint was being updated. Refresh and try again." };

  revalidateTaskPaths(access.projectId);
  return { data: { updated: true } };
}

export async function deleteTask(input: { taskId: string } | string): Promise<TasksActionResult> {
  const parsed = taskIdInputSchema.safeParse(
    typeof input === "string" ? { taskId: input } : input,
  );
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const { count, error: attachmentError } = await supabase
    .from("task_attachments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("task_id", access.task.id);
  if (attachmentError) return { error: "Unable to verify task attachments." };
  if ((count ?? 0) > 0) {
    return { error: "Delete this task's attachments before deleting the task." };
  }

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.task.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: safeDatabaseError(error, "Unable to delete the task.") };
  if (!data) return { error: "Task not found." };

  revalidateTaskPaths(access.projectId);
  return { data: { deleted: true } };
}

export async function createWorkflowColumn(input: {
  projectId: string;
  name: string;
}): Promise<TasksActionResult<BoardColumn>> {
  const parsed = createWorkflowColumnSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };

  const supabase = await createClient();
  const accessResult = await resolveProjectAccess(supabase, parsed.data.projectId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  const { data: lastColumn } = await supabase
    .from("project_workflow_columns")
    .select("position")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("project_workflow_columns")
    .insert({
      tenant_id: access.tenantId,
      project_id: access.projectId,
      name: parsed.data.name,
      position: lastColumn ? Number(lastColumn.position) + 1 : 0,
      created_by: access.userId,
    })
    .select("id, project_id, name, position")
    .single();
  if (error || !data) {
    return { error: safeDatabaseError(error ?? {}, "Unable to create the column.") };
  }
  revalidateTaskPaths(access.projectId);
  return { data: { ...data, position: Number(data.position) } as BoardColumn };
}

async function resolveColumnAccess(
  supabase: SupabaseClient,
  columnId: string,
): Promise<TasksActionResult<ProjectAccess & { column: BoardColumn }>> {
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const { data: column, error } = await supabase
    .from("project_workflow_columns")
    .select("id, project_id, name, position")
    .eq("tenant_id", actorResult.data.tenantId)
    .eq("id", columnId)
    .maybeSingle();
  if (error || !column) return { error: "Column not found or access denied." };
  const accessResult = await resolveProjectAccess(supabase, column.project_id);
  if (!accessResult.data) return { error: accessResult.error };
  return {
    data: {
      ...accessResult.data,
      column: { ...column, position: Number(column.position) } as BoardColumn,
    },
  };
}

export async function renameWorkflowColumn(input: {
  columnId: string;
  name: string;
}): Promise<TasksActionResult> {
  const parsed = renameWorkflowColumnSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const accessResult = await resolveColumnAccess(supabase, parsed.data.columnId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  const { error } = await supabase
    .from("project_workflow_columns")
    .update({ name: parsed.data.name })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.column.id);
  if (error) return { error: safeDatabaseError(error, "Unable to rename the column.") };
  revalidateTaskPaths(access.projectId);
  return { data: { updated: true } };
}

export async function reorderWorkflowColumn(input: {
  columnId: string;
  direction: "left" | "right";
}): Promise<TasksActionResult> {
  const parsed = reorderWorkflowColumnSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const accessResult = await resolveColumnAccess(supabase, parsed.data.columnId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const { data: columns, error: columnsError } = await supabase
    .from("project_workflow_columns")
    .select("id, position")
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .order("position");
  if (columnsError) return { error: "Unable to inspect column order." };
  const index = (columns ?? []).findIndex((column) => column.id === access.column.id);
  const neighborIndex = parsed.data.direction === "left" ? index - 1 : index + 1;
  const neighbor = columns?.[neighborIndex];
  if (index < 0 || !neighbor) return { error: "This column is already at that edge." };

  const currentPosition = Number(columns![index].position);
  const neighborPosition = Number(neighbor.position);
  const temporaryPosition = Math.max(...columns!.map((column) => Number(column.position))) + 1;
  const { data: currentMoved, error: firstError } = await supabase
    .from("project_workflow_columns")
    .update({ position: temporaryPosition })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.column.id)
    .eq("position", currentPosition)
    .select("id")
    .maybeSingle();
  if (firstError || !currentMoved) {
    return { error: "The column order changed. Refresh and try again." };
  }

  const { data: neighborMoved, error: secondError } = await supabase
    .from("project_workflow_columns")
    .update({ position: currentPosition })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", neighbor.id)
    .eq("position", neighborPosition)
    .select("id")
    .maybeSingle();
  if (secondError || !neighborMoved) {
    const { error: rollbackError } = await supabase
      .from("project_workflow_columns")
      .update({ position: currentPosition })
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("id", access.column.id)
      .eq("position", temporaryPosition);
    return {
      error: rollbackError
        ? "Column reordering failed and its temporary position could not be restored. Refresh before trying again."
        : "The column order changed. Refresh and try again.",
    };
  }

  const { data: swapCompleted, error: thirdError } = await supabase
    .from("project_workflow_columns")
    .update({ position: neighborPosition })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.column.id)
    .eq("position", temporaryPosition)
    .select("id")
    .maybeSingle();
  if (thirdError || !swapCompleted) {
    const { error: neighborRollbackError } = await supabase
      .from("project_workflow_columns")
      .update({ position: neighborPosition })
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("id", neighbor.id)
      .eq("position", currentPosition);
    const { error: currentRollbackError } = await supabase
      .from("project_workflow_columns")
      .update({ position: currentPosition })
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("id", access.column.id)
      .eq("position", temporaryPosition);
    return {
      error:
        neighborRollbackError || currentRollbackError
          ? "Column reordering failed and could not be fully restored. Refresh before trying again."
          : "Unable to reorder the column.",
    };
  }

  revalidateTaskPaths(access.projectId);
  return { data: { reordered: true } };
}

export async function deleteWorkflowColumn(input: {
  columnId: string;
}): Promise<TasksActionResult> {
  const parsed = workflowColumnIdSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const accessResult = await resolveColumnAccess(supabase, parsed.data.columnId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const { count, error: countError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("column_id", access.column.id);
  if (countError) return { error: "Unable to inspect the column." };
  if ((count ?? 0) > 0) {
    return { error: "Move or delete every task in this column before deleting it." };
  }

  const { error } = await supabase
    .from("project_workflow_columns")
    .delete()
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", access.column.id);
  if (error) return { error: safeDatabaseError(error, "Unable to delete the column.") };
  revalidateTaskPaths(access.projectId);
  return { data: { deleted: true } };
}

export async function getTaskDetails(taskId: string): Promise<TasksActionResult<TaskDetail>> {
  const parsed = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).safeParse(taskId);
  if (!parsed.success) return { error: "Invalid task identifier." };
  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;

  const [assignmentsResult, commentsResult, attachmentsResult, activityResult, membersResult] =
    await Promise.all([
      supabase
        .from("task_assignees")
        .select("user_id")
        .eq("tenant_id", access.tenantId)
        .eq("project_id", access.projectId)
        .eq("task_id", access.task.id),
      supabase
        .from("task_comments")
        .select("id, body, author_user_id, created_at")
        .eq("tenant_id", access.tenantId)
        .eq("project_id", access.projectId)
        .eq("task_id", access.task.id)
        .order("created_at"),
      supabase
        .from("task_attachments")
        .select("id, file_name, mime_type, size_bytes, uploaded_by, created_at")
        .eq("tenant_id", access.tenantId)
        .eq("project_id", access.projectId)
        .eq("task_id", access.task.id)
        .order("created_at"),
      supabase
        .from("task_activity")
        .select("id, action, entity_type, actor_user_id, occurred_at")
        .eq("tenant_id", access.tenantId)
        .eq("project_id", access.projectId)
        .eq("task_id", access.task.id)
        .order("occurred_at", { ascending: false })
        .limit(100),
      loadMemberOptions(supabase, access),
    ]);
  if (
    assignmentsResult.error ||
    commentsResult.error ||
    attachmentsResult.error ||
    activityResult.error ||
    !membersResult.data
  ) {
    return { error: "Unable to load task collaboration details." };
  }

  const profileIds = new Set<string>();
  for (const comment of commentsResult.data ?? []) profileIds.add(comment.author_user_id);
  for (const attachment of attachmentsResult.data ?? []) profileIds.add(attachment.uploaded_by);
  for (const activity of activityResult.data ?? []) {
    if (activity.actor_user_id) profileIds.add(activity.actor_user_id);
  }
  const { data: profiles } =
    profileIds.size > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("tenant_id", access.tenantId)
          .in("id", [...profileIds])
      : { data: [] as ProjectMemberOption[] };
  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name || profile.email]),
  );
  const memberById = new Map(membersResult.data.map((member) => [member.id, member]));
  const assigneeIds = (assignmentsResult.data ?? []).map((assignment) => assignment.user_id);

  return {
    data: {
      task: {
        ...access.task,
        position: Number(access.task.position),
        assignee_ids: assigneeIds,
        assignees: assigneeIds.flatMap((id) => {
          const member = memberById.get(id);
          return member ? [member] : [];
        }),
      },
      comments: (commentsResult.data ?? []).map((comment) => ({
        ...comment,
        author_name: profileById.get(comment.author_user_id) ?? "Project member",
      })),
      attachments: (attachmentsResult.data ?? []).map((attachment) => ({
        ...attachment,
        size_bytes: Number(attachment.size_bytes),
        uploader_name: profileById.get(attachment.uploaded_by) ?? "Project member",
      })),
      activity: (activityResult.data ?? []).map((activity) => ({
        ...activity,
        actor_name: activity.actor_user_id
          ? (profileById.get(activity.actor_user_id) ?? "Project member")
          : "System",
      })),
    },
  };
}

export async function createTaskComment(input: {
  taskId: string;
  body: string;
}): Promise<TasksActionResult> {
  const parsed = createTaskCommentSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  const { error } = await supabase.from("task_comments").insert({
    tenant_id: access.tenantId,
    project_id: access.projectId,
    task_id: access.task.id,
    author_user_id: access.userId,
    body: parsed.data.body,
  });
  if (error) return { error: safeDatabaseError(error, "Unable to add the comment.") };
  revalidateTaskPaths(access.projectId);
  return { data: { created: true } };
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
  return cleaned || "attachment";
}

export async function uploadTaskAttachment(formData: FormData): Promise<TasksActionResult> {
  const fileValue = formData.get("file");
  const taskId = formData.get("taskId");
  if (!(fileValue instanceof File) || typeof taskId !== "string") {
    return { error: "Select a file to upload." };
  }
  const fileName = sanitizeFileName(fileValue.name);
  const parsed = taskAttachmentMetadataSchema.safeParse({
    taskId,
    fileName,
    mimeType: fileValue.type || "application/octet-stream",
    sizeBytes: fileValue.size,
  });
  if (!parsed.success) return { error: "Files must be between 1 byte and 10 MiB." };

  const supabase = await createClient();
  const accessResult = await resolveTaskAccess(supabase, parsed.data.taskId);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };
  const extensionCandidate = fileName.split(".").pop()?.toLowerCase() ?? "";
  const extension = /^[a-z0-9]{1,10}$/.test(extensionCandidate)
    ? `.${extensionCandidate}`
    : "";
  const storagePath = `${access.tenantId}/${access.projectId}/${access.task.id}/${crypto.randomUUID()}${extension}`;

  const { data: metadata, error: metadataError } = await supabase
    .from("task_attachments")
    .insert({
      tenant_id: access.tenantId,
      project_id: access.projectId,
      task_id: access.task.id,
      uploaded_by: access.userId,
      bucket: "task-attachments",
      storage_path: storagePath,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
    })
    .select("id")
    .single();
  if (metadataError || !metadata) {
    return { error: safeDatabaseError(metadataError ?? {}, "Unable to prepare the attachment.") };
  }

  const { error: uploadError } = await supabase.storage
    .from("task-attachments")
    .upload(storagePath, fileValue, {
      cacheControl: "3600",
      contentType: parsed.data.mimeType,
      upsert: false,
    });
  if (uploadError) {
    const { error: objectCleanupError } = await supabase.storage
      .from("task-attachments")
      .remove([storagePath]);
    const { error: metadataCleanupError } = await supabase
      .from("task_attachments")
      .delete()
      .eq("tenant_id", access.tenantId)
      .eq("project_id", access.projectId)
      .eq("task_id", access.task.id)
      .eq("id", metadata.id);
    return {
      error: objectCleanupError || metadataCleanupError
        ? "Upload failed and its pending object or metadata could not be fully cleaned up."
        : "Unable to upload the attachment.",
    };
  }

  revalidateTaskPaths(access.projectId);
  return { data: { uploaded: true } };
}

export async function deleteTaskAttachment(input: {
  attachmentId: string;
}): Promise<TasksActionResult> {
  const parsed = taskAttachmentIdSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const actor = actorResult.data;
  const { data: attachment, error: attachmentError } = await supabase
    .from("task_attachments")
    .select("id, project_id, storage_path, mime_type")
    .eq("tenant_id", actor.tenantId)
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (attachmentError || !attachment) return { error: "Attachment not found or access denied." };
  const accessResult = await resolveProjectAccess(supabase, attachment.project_id);
  if (!accessResult.data) return { error: accessResult.error };
  const access = accessResult.data;
  const archivedError = archivedProjectWriteError(access);
  if (archivedError) return { error: archivedError };

  const { data: backup, error: downloadError } = await supabase.storage
    .from("task-attachments")
    .download(attachment.storage_path);
  if (downloadError || !backup) return { error: "Unable to verify the stored attachment." };
  const { error: storageError } = await supabase.storage
    .from("task-attachments")
    .remove([attachment.storage_path]);
  if (storageError) return { error: "Unable to delete the stored attachment." };

  const { error: metadataError } = await supabase
    .from("task_attachments")
    .delete()
    .eq("tenant_id", access.tenantId)
    .eq("project_id", access.projectId)
    .eq("id", attachment.id);
  if (metadataError) {
    const { error: restoreError } = await supabase.storage
      .from("task-attachments")
      .upload(attachment.storage_path, backup, {
        contentType: attachment.mime_type ?? "application/octet-stream",
        upsert: false,
      });
    return {
      error: restoreError
        ? "Attachment metadata could not be deleted and the stored object could not be restored."
        : "Attachment metadata could not be deleted; the stored object was restored.",
    };
  }

  revalidateTaskPaths(access.projectId);
  return { data: { deleted: true } };
}

export async function getTaskAttachmentDownloadUrl(input: {
  attachmentId: string;
}): Promise<TasksActionResult<{ signedUrl: string }>> {
  const parsed = taskAttachmentIdSchema.safeParse(input);
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const { data: attachment, error: attachmentError } = await supabase
    .from("task_attachments")
    .select("project_id, storage_path")
    .eq("tenant_id", actorResult.data.tenantId)
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (attachmentError || !attachment) return { error: "Attachment not found or access denied." };
  const accessResult = await resolveProjectAccess(supabase, attachment.project_id);
  if (!accessResult.data) return { error: accessResult.error };
  const { data, error } = await supabase.storage
    .from("task-attachments")
    .createSignedUrl(attachment.storage_path, 60);
  if (error || !data) return { error: "Unable to create a download link." };
  return { data: { signedUrl: data.signedUrl } };
}

export async function listMyCards(input?: {
  page?: number;
  pageSize?: number;
}): Promise<TasksActionResult<MyCardsPage>> {
  const parsed = listMyCardsSchema.safeParse(input ?? {});
  if (!parsed.success) return { error: validationError() };
  const supabase = await createClient();
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const { data, error } = await supabase.rpc("list_my_cards", {
    p_limit: parsed.data.pageSize,
    p_offset: offset,
  });
  if (error) return { error: safeDatabaseError(error, "Unable to load assigned tasks.") };

  const payload = myCardsRpcPayloadSchema.safeParse(data);
  if (!payload.success) return { error: "Unable to read assigned tasks." };
  const { rows, count } = payload.data;
  if (!Number.isSafeInteger(count) || count < 0) {
    return { error: "Unable to read the assigned task count." };
  }
  return {
    data: {
      rows,
      count,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    },
  };
}
