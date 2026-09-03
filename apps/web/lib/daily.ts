export const DAILY_PLANNED_WORK_KEY = "planned_work" as const;
export const DAILY_BLOCKERS_KEY = "blockers" as const;

export function parseDailyTaskLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-•])\s?/, "").trim())
    .filter(Boolean);
}

export function isDailyPlannedWorkQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_PLANNED_WORK_KEY) return true;
  const normalized = questionText?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿¡]/g, "").toLowerCase().trim();
  return normalized === "what will you work on next?" || normalized === "en que trabajaras hoy?";
}

export function isDailyBlockerQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_BLOCKERS_KEY) return true;
  const normalized = questionText?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return normalized === "are there any blockers or risks?" || normalized?.includes("blocker") === true || normalized?.includes("bloqueo") === true;
}
