"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTask,
  setTaskCurrentSprint,
  type BoardColumn,
  type BoardTask,
  type ProjectMemberOption,
} from "@/app/actions/tasks";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { TaskDetailDialog } from "./TaskDetailDialog";

const priorityLabel: Record<BoardTask["priority"], string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export function TaskList({
  initialTasks,
  columns,
  members,
  readOnly,
}: {
  initialTasks: BoardTask[];
  columns: BoardColumn[];
  members: ProjectMemberOption[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeSprint(task: BoardTask) {
    if (readOnly) return;
    const isCurrentSprint = !task.is_current_sprint;
    setError(null);
    startTransition(async () => {
      const result = await setTaskCurrentSprint({ taskId: task.id, isCurrentSprint });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, is_current_sprint: isCurrentSprint } : item,
        ),
      );
      router.refresh();
    });
  }

  function removeTask(task: BoardTask) {
    if (readOnly) return;
    if (!window.confirm("¿Eliminar esta tarea? Primero quitá sus archivos adjuntos. También se eliminarán los comentarios y las asignaciones.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTask({ taskId: task.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTasks((current) => current.filter((item) => item.id !== task.id));
      router.refresh();
    });
  }

  return (
    <section className="task-list-root" aria-label="Lista de tareas" aria-busy={pending}>
      <p className="muted small-text task-list-intro">
        Todas las tareas del proyecto. Agregá las del Backlog al Sprint actual cuando estés listo para trabajarlas.
      </p>
      <p className="board-visually-hidden" aria-live="polite">
        {pending ? "Actualizando la tarea…" : ""}
      </p>
      {error ? <p className="form-error" role="status" aria-live="polite">{error}</p> : null}
      {tasks.length === 0 ? (
        <p className="empty-state">Todavía no hay tareas. Creá la primera desde Agregar tarea.</p>
      ) : (
        <ul className="task-list-items">
          {tasks.map((task) => (
            <li key={task.id} className={`task-list-item board-priority-${task.priority}`}>
              <div className="task-list-item-main">
                <div className="task-list-item-header">
                  <button
                    type="button"
                    className="task-list-title"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    {task.title}
                  </button>
                  <span className="task-priority">{priorityLabel[task.priority]}</span>
                </div>
                <p className="task-list-description">{task.description}</p>
                <p className="muted small-text task-list-meta">
                  {formatTaskEstimate(task.estimate_quantity, task.estimate_unit)} · {task.assignees.length > 0
                    ? task.assignees.map((assignee) => assignee.full_name || assignee.email).join(", ")
                    : "Sin asignar"}
                </p>
              </div>
              <div className="task-list-item-actions">
                <span className={`task-sprint-status${task.is_current_sprint ? " is-current" : ""}`}>
                  {task.is_current_sprint ? "Sprint actual" : "Backlog"}
                </span>
                {!readOnly ? (
                  <button
                    type="button"
                    className="secondary-button board-compact-button"
                    disabled={pending}
                    onClick={() => changeSprint(task)}
                  >
                    {task.is_current_sprint ? "Enviar al Backlog" : "Agregar al Sprint"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="board-card-action"
                  disabled={pending}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  Ver detalles
                </button>
                {!readOnly ? (
                  <button
                    type="button"
                    className="board-card-action board-danger-button"
                    disabled={pending}
                    onClick={() => removeTask(task)}
                  >
                    Eliminar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {selectedTaskId ? (
        <TaskDetailDialog
          taskId={selectedTaskId}
          columns={columns}
          members={members}
          readOnly={readOnly}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}
