"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  submitDailyTaskCompletion,
  type DailyTaskActionState,
  type DailyTaskRow,
} from "@/app/actions/daily-tasks";

const initialState: DailyTaskActionState = { status: "idle", message: "" };

export function DailyCompletionChecklist({
  teamId,
  logicalDate,
  tasks,
}: {
  teamId: string;
  logicalDate: string;
  tasks: DailyTaskRow[];
}) {
  const [state, formAction, pending] = useActionState(submitDailyTaskCompletion, initialState);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const handledSuccess = useRef<DailyTaskActionState | null>(null);
  const router = useRouter();
  const uncheckedCount = useMemo(() => tasks.length - completedIds.size, [completedIds, tasks.length]);

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
    if (state.status === "success" && handledSuccess.current !== state) {
      handledSuccess.current = state;
      router.refresh();
    }
  }, [router, state]);

  if (state.status === "success") {
    return <p className="action-message success" role="status">Cierre Daily registrado.</p>;
  }

  return (
    <section className="daily-task-completion" aria-labelledby="daily-task-completion-heading">
      <div className="daily-task-heading">
        <div>
          <p className="eyebrow">Cierre de hoy</p>
          <h2 id="daily-task-completion-heading">¿Qué lograste acabar hoy?</h2>
          <p className="muted small-text">Marcá las tareas terminadas. Las restantes se eliminan o pasan a mañana según tu elección.</p>
        </div>
        <span className="daily-state warning">Después de las 16:00</span>
      </div>
      <form action={formAction} className="daily-form daily-completion-form">
        <input name="teamId" type="hidden" value={teamId} />
        <input name="logicalDate" type="hidden" value={logicalDate} />
        <ol className="daily-checklist">
          {tasks.map((task) => (
            <li key={task.id}>
              <label>
                <input
                  checked={completedIds.has(task.id)}
                  name="completedTaskId"
                  onChange={(event) => {
                    setCompletedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(task.id);
                      else next.delete(task.id);
                      return next;
                    });
                  }}
                  type="checkbox"
                  value={task.id}
                />
                <span>{task.title}</span>
              </label>
            </li>
          ))}
        </ol>
        {state.message ? (
          <p
            aria-live="polite"
            className={state.status === "error" ? "action-message error" : "action-message success"}
            ref={state.status === "error" ? errorRef : undefined}
            role={state.status === "error" ? "alert" : "status"}
            tabIndex={state.status === "error" ? -1 : undefined}
          >
            {state.message}
          </p>
        ) : null}
        {uncheckedCount > 0 ? (
          <div className="daily-completion-choices" aria-label="Resolución de tareas pendientes">
            <p className="muted small-text">Quedan {uncheckedCount} tareas pendientes. Elegí una opción:</p>
            <div>
              <button className="secondary-button danger-button" disabled={pending} name="resolution" type="submit" value="delete">
                Eliminar las restantes
              </button>
              <button className="primary-button" disabled={pending} name="resolution" type="submit" value="carry">
                Pasarlas a mañana
              </button>
            </div>
          </div>
        ) : (
          <button className="primary-button" disabled={pending} name="resolution" type="submit" value="none">
            {pending ? "Registrando…" : "Registrar cierre"}
          </button>
        )}
      </form>
    </section>
  );
}
