"use server";

import { dailyTaskCompletionSchema, dailyTaskTitlesSchema } from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import { parseDailyTaskLines } from "@/lib/daily";
import { createClient } from "@/utils/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type DailyTaskActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type DailyTaskRow = {
  id: string;
  tenant_id: string;
  team_id: string;
  user_id: string;
  logical_date: string;
  title: string;
  position: number;
  carried_from_id: string | null;
  status: "planned" | "completed" | "deleted" | "carried";
  created_at: string;
  updated_at: string;
};

export type DailyTaskWorkspace = {
  status: "ready" | "select_team" | "unavailable";
  message?: string;
  teamId?: string;
  teamName?: string;
  timezoneName?: string;
  localDate?: string;
  yesterdayDate?: string;
  phase?: "planning" | "completion";
  completionSubmitted?: boolean;
  tasks: DailyTaskRow[];
  yesterdayCompletedTasks: DailyTaskRow[];
  teamOptions: Array<{ id: string; name: string }>;
};

export type DailyTaskWorkspaceResult = {
  data?: DailyTaskWorkspace;
  error?: string;
};

type DailyActor = {
  userId: string;
  tenantId: string;
  role: InternalRole;
};

type DailyTeamContext = DailyActor & {
  teamId: string;
  teamName: string;
  timezoneName: string;
  localDate: string;
  yesterdayDate: string;
  phase: "planning" | "completion";
  teamOptions: Array<{ id: string; name: string }>;
};

function success(message: string): DailyTaskActionState {
  return { status: "success", message };
}

function failure(message: string): DailyTaskActionState {
  return { status: "error", message };
}

function fields(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function uuid(value: string | null | undefined): string | undefined {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function localDateParts(now: Date, timezoneName: string): { localDate: string; localTime: string } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezoneName,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(now)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    return {
      localDate: `${parts.year}-${parts.month}-${parts.day}`,
      localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    };
  } catch {
    return null;
  }
}

function previousDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function resolveActor(supabase: SupabaseClient): Promise<{ data?: DailyActor; error?: string }> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { error: "Tu sesión venció. Volvé a iniciar sesión." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role, status")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (
    profileError ||
    !profile ||
    profile.status !== "active" ||
    typeof profile.tenant_id !== "string" ||
    !isInternalRole(profile.role)
  ) {
    return { error: "Se requiere una cuenta interna activa." };
  }
  return { data: { userId: auth.user.id, tenantId: profile.tenant_id, role: profile.role } };
}

async function loadTeamOptions(
  supabase: SupabaseClient,
  actor: DailyActor,
  teamIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (teamIds.length === 0) return [];
  const { data } = await supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", actor.tenantId)
    .in("id", teamIds)
    .is("archived_at", null)
    .order("name");
  return (data ?? []) as Array<{ id: string; name: string }>;
}

async function resolveTeamContext(
  supabase: SupabaseClient,
  requestedTeamId?: string,
): Promise<{ data?: DailyTeamContext; workspace?: DailyTaskWorkspace; error?: string }> {
  const actorResult = await resolveActor(supabase);
  if (!actorResult.data) return { error: actorResult.error };
  const actor = actorResult.data;

  let teamIds: string[];
  if (isAdmin(actor.role)) {
    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("id")
      .eq("tenant_id", actor.tenantId)
      .is("archived_at", null);
    if (teamsError) return { error: "No se pudieron cargar los equipos Daily del tenant." };
    teamIds = (teams ?? []).map((team) => String(team.id));
  } else {
    const { data: memberships, error: membershipError } = await supabase
      .from("team_memberships")
      .select("team_id")
      .eq("tenant_id", actor.tenantId)
      .eq("user_id", actor.userId);
    if (membershipError) return { error: "No se pudieron cargar tus equipos Daily." };
    teamIds = (memberships ?? []).map((membership) => String(membership.team_id));
  }

  teamIds = [...new Set(teamIds)];
  const teamOptions = await loadTeamOptions(supabase, actor, teamIds);
  const availableIds = new Set(teamOptions.map((team) => team.id));
  const selectedTeamId = requestedTeamId && availableIds.has(requestedTeamId)
    ? requestedTeamId
    : teamOptions.length === 1
      ? teamOptions[0].id
      : undefined;

  if (!selectedTeamId) {
    return {
      workspace: {
        status: teamOptions.length > 1 ? "select_team" : "unavailable",
        message: teamOptions.length > 1
          ? "Seleccioná un equipo para ver tu plan Daily sin mezclar equipos."
          : "No tenés un equipo Daily activo disponible.",
        tasks: [],
        yesterdayCompletedTasks: [],
        teamOptions,
      },
    };
  }

  const team = teamOptions.find((option) => option.id === selectedTeamId);
  const { data: schedule, error: scheduleError } = await supabase
    .from("team_daily_schedules")
    .select("timezone_name")
    .eq("tenant_id", actor.tenantId)
    .eq("team_id", selectedTeamId)
    .eq("is_active", true)
    .maybeSingle();
  if (scheduleError) return { error: "No se pudo cargar el horario Daily del equipo." };
  if (!team || !schedule || typeof schedule.timezone_name !== "string" || !schedule.timezone_name.trim()) {
    return {
      workspace: {
        status: "unavailable",
        message: "El equipo no tiene una zona horaria IANA configurada para Daily.",
        tasks: [],
        yesterdayCompletedTasks: [],
        teamOptions,
      },
    };
  }

  const parts = localDateParts(new Date(), schedule.timezone_name);
  if (!parts) {
    return {
      workspace: {
        status: "unavailable",
        message: "La zona horaria IANA del equipo no se puede resolver en el servidor.",
        tasks: [],
        yesterdayCompletedTasks: [],
        teamOptions,
      },
    };
  }

  const phase = parts.localTime >= "16:00:00" ? "completion" : "planning";
  return {
    data: {
      ...actor,
      teamId: selectedTeamId,
      teamName: team.name,
      timezoneName: schedule.timezone_name,
      localDate: parts.localDate,
      yesterdayDate: previousDate(parts.localDate),
      phase,
      teamOptions,
    },
  };
}

export async function getDailyTaskWorkspace(requestedTeamId?: string): Promise<DailyTaskWorkspaceResult> {
  const supabase = await createClient();
  const result = await resolveTeamContext(supabase, uuid(requestedTeamId));
  if (result.workspace) return { data: result.workspace };
  if (!result.data) return { error: result.error ?? "No se pudo resolver el equipo Daily." };
  const context = result.data;

  const [todayResult, yesterdayResult, completionResult] = await Promise.all([
    supabase
      .from("daily_task_items")
      .select("id, tenant_id, team_id, user_id, logical_date, title, position, carried_from_id, status, created_at, updated_at")
      .eq("tenant_id", context.tenantId)
      .eq("team_id", context.teamId)
      .eq("user_id", context.userId)
      .eq("logical_date", context.localDate)
      .eq("status", "planned")
      .order("position")
      .order("created_at"),
    supabase
      .from("daily_task_items")
      .select("id, tenant_id, team_id, user_id, logical_date, title, position, carried_from_id, status, created_at, updated_at")
      .eq("tenant_id", context.tenantId)
      .eq("team_id", context.teamId)
      .eq("user_id", context.userId)
      .eq("logical_date", context.yesterdayDate)
      .eq("status", "completed")
      .order("position")
      .order("created_at"),
    supabase
      .from("daily_task_completions")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("team_id", context.teamId)
      .eq("user_id", context.userId)
      .eq("logical_date", context.localDate)
      .maybeSingle(),
  ]);
  if (todayResult.error || yesterdayResult.error || completionResult.error) {
    return { error: "No se pudo cargar tu plan Daily. Actualizá la página e intentá nuevamente." };
  }

  return {
    data: {
      status: "ready",
      teamId: context.teamId,
      teamName: context.teamName,
      timezoneName: context.timezoneName,
      localDate: context.localDate,
      yesterdayDate: context.yesterdayDate,
      phase: context.phase,
      completionSubmitted: Boolean(completionResult.data),
      tasks: (todayResult.data ?? []).map((task) => ({ ...task, position: Number(task.position) })) as DailyTaskRow[],
      yesterdayCompletedTasks: (yesterdayResult.data ?? []).map((task) => ({ ...task, position: Number(task.position) })) as DailyTaskRow[],
      teamOptions: context.teamOptions,
    },
  };
}

export async function addDailyTaskItems(
  _previousState: DailyTaskActionState,
  formData: FormData,
): Promise<DailyTaskActionState> {
  const rawLines = String(formData.get("taskLines") ?? "");
  const parsed = dailyTaskTitlesSchema.safeParse({
    teamId: fields(formData).teamId,
    titles: parseDailyTaskLines(rawLines),
  });
  if (!parsed.success) return failure("Agregá al menos una tarea, una por línea, de hasta 400 caracteres.");

  const supabase = await createClient();
  const contextResult = await resolveTeamContext(supabase, parsed.data.teamId);
  if (!contextResult.data) return failure(contextResult.workspace?.message ?? contextResult.error ?? "No se pudo resolver el equipo Daily.");
  const context = contextResult.data;
  if (context.phase !== "planning") return failure("La planificación de hoy terminó a las 16:00 del equipo.");

  const { error } = await supabase.rpc("add_daily_task_items", {
    p_team_id: context.teamId,
    p_logical_date: context.localDate,
    p_titles: parsed.data.titles,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("closed for the team local date")) return failure("La planificación de hoy terminó a las 16:00 del equipo.");
    if (message.includes("timezone")) return failure("El equipo no tiene una zona horaria IANA válida configurada.");
    return failure("No se pudieron guardar las tareas Daily. Actualizá la página e intentá nuevamente.");
  }

  revalidatePath("/workspace/daily");
  revalidatePath("/workspace/dashboard");
  return success("Tareas agregadas a tu plan de hoy.");
}

export async function submitDailyTaskCompletion(
  _previousState: DailyTaskActionState,
  formData: FormData,
): Promise<DailyTaskActionState> {
  const parsed = dailyTaskCompletionSchema.safeParse({
    teamId: fields(formData).teamId,
    logicalDate: fields(formData).logicalDate,
    completedTaskIds: formData.getAll("completedTaskId").map(String),
    resolution: fields(formData).resolution ?? "none",
  });
  if (!parsed.success) return failure("Revisá la lista de tareas y elegí una resolución válida.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_daily_task_completion", {
    p_team_id: parsed.data.teamId,
    p_logical_date: parsed.data.logicalDate,
    p_completed_task_ids: parsed.data.completedTaskIds,
    p_unchecked_resolution: parsed.data.resolution,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("after the team local 16:00 cutoff")) return failure("La lista se puede cerrar después de las 16:00 del equipo.");
    if (message.includes("does not match the team local date")) return failure("La fecha del plan cambió. Actualizá la página.");
    if (message.includes("choose delete or carry")) return failure("Elegí eliminar o pasar a mañana las tareas pendientes.");
    if (message.includes("already exists") || message.includes("duplicate key")) return failure("El cierre Daily ya fue registrado. Actualizá la página.");
    if (message.includes("timezone")) return failure("El equipo no tiene una zona horaria IANA válida configurada.");
    return failure("No se pudo cerrar el plan Daily. Actualizá la página e intentá nuevamente.");
  }

  revalidatePath("/workspace/daily");
  revalidatePath("/workspace/dashboard");
  return success("Cierre Daily registrado. Tu evidencia queda inmutable.");
}
