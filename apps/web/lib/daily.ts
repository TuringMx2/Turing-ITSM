export const DAILY_PLANNED_WORK_KEY = "planned_work" as const;
export const DAILY_COMPLETED_WORK_KEY = "completed_work" as const;
export const DAILY_BLOCKERS_KEY = "blockers" as const;

export function isDailyPlannedWorkQuestion(
  semanticKey: string | null | undefined,
): boolean {
  return semanticKey === DAILY_PLANNED_WORK_KEY;
}

export function isDailyCompletedWorkQuestion(
  semanticKey: string | null | undefined,
): boolean {
  return semanticKey === DAILY_COMPLETED_WORK_KEY;
}

export function isDailyBlockerQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_BLOCKERS_KEY) return true;
  const normalized = questionText?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return normalized === "are there any blockers or risks?" || normalized?.includes("blocker") === true || normalized?.includes("bloqueo") === true;
}
