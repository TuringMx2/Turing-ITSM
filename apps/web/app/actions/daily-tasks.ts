"use server";

import { dailyTaskCompletionSchema } from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type DailyTaskActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const success = (message: string): DailyTaskActionState => ({ status: "success", message });
const failure = (message: string): DailyTaskActionState => ({ status: "error", message });

function formFields(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

export async function submitDailyTaskCompletion(
  _previousState: DailyTaskActionState,
  formData: FormData,
): Promise<DailyTaskActionState> {
  const parsed = dailyTaskCompletionSchema.safeParse({
    teamId: formFields(formData).teamId,
    logicalDate: formFields(formData).logicalDate,
    completedTaskIds: formData.getAll("completedTaskId").map(String),
    resolution: formFields(formData).resolution ?? "none",
  });
  if (!parsed.success) return failure("Revisá la lista de actividades y elegí una resolución válida.");

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
    if (message.includes("choose delete or carry")) return failure("Elegí eliminar o pasar al próximo Daily las actividades pendientes.");
    if (message.includes("already exists") || message.includes("duplicate key")) return failure("El cierre Daily ya fue registrado. Actualizá la página.");
    if (message.includes("timezone")) return failure("El equipo no tiene una zona horaria IANA válida configurada.");
    return failure("No se pudo cerrar el plan Daily. Actualizá la página e intentá nuevamente.");
  }

  revalidatePath("/workspace/daily");
  revalidatePath("/workspace/dashboard");
  return success("Cierre Daily registrado. Tu evidencia queda inmutable.");
}
