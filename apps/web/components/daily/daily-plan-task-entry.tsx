"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  addDailyTaskItems,
  type DailyTaskActionState,
  type DailyTaskRow,
} from "@/app/actions/daily-tasks";

const initialState: DailyTaskActionState = { status: "idle", message: "" };

export function DailyPlanTaskEntry({
  teamId,
  tasks,
}: {
  teamId: string;
  tasks: DailyTaskRow[];
}) {
  const [state, formAction, pending] = useActionState(addDailyTaskItems, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
    if (state.status === "success") router.refresh();
  }, [router, state]);

  return (
    <section className="daily-task-plan" aria-labelledby="daily-task-plan-heading">
      <div className="daily-task-heading">
        <div>
          <p className="eyebrow">Plan de hoy</p>
          <h2 id="daily-task-plan-heading">¿En qué trabajarás hoy?</h2>
          <p className="muted small-text">Agregá una tarea por línea. También podés usar “-” o “•”.</p>
        </div>
        <span className="daily-state">{tasks.length} tareas</span>
      </div>
      {tasks.length > 0 ? (
        <ol className="daily-task-list">
          {tasks.map((task) => <li key={task.id}>{task.title}</li>)}
        </ol>
      ) : <p className="empty-state">Todavía no agregaste tareas para hoy.</p>}
      <form action={formAction} className="daily-form daily-task-entry-form">
        <input name="teamId" type="hidden" value={teamId} />
        <label>
          <span>Agregar tareas</span>
          <textarea
            autoComplete="off"
            maxLength={40_000}
            name="taskLines"
            placeholder={"Preparar el informe semanal\n- Revisar la cola de tickets\n• Coordinar la entrega"}
            rows={4}
          />
        </label>
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
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Guardando…" : "Agregar al plan"}
        </button>
      </form>
    </section>
  );
}
