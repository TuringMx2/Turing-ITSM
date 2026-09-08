"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTask,
  setTaskCurrentSprint,
  type BoardColumn,
  type BoardTask,
  type ProjectMemberOption,
} from "@/app/actions/tasks";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { AssigneeAvatars } from "./AssigneePicker";
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
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const backlogTasks = useMemo(() => tasks.filter((task) => !task.is_current_sprint), [tasks]);
  const columnById = useMemo(() => new Map(columns.map((column) => [column.id, column.name])), [columns]);

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
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, is_current_sprint: isCurrentSprint } : item));
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
      setSelectedTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      router.refresh();
    });
  }

  return (
    <section className="project-task-list" aria-label="Backlog de tareas" aria-busy={pending}>
      <header className="project-task-list-header">
        <div>
          <h3>Backlog ({backlogTasks.length} actividades)</h3>
          <p className="muted small-text">Actividades fuera del Sprint actual.</p>
        </div>
        <span className="project-task-list-count" aria-label={`${backlogTasks.length} actividades en el Backlog`}>{backlogTasks.length}</span>
      </header>
      <p className="board-visually-hidden" aria-live="polite">
        {pending ? "Actualizando la tarea…" : ""}
      </p>
      {error ? <p className="form-error" role="status" aria-live="polite">{error}</p> : null}
      {backlogTasks.length === 0 ? (
        <p className="empty-state project-task-list-empty">No hay actividades en el Backlog.</p>
      ) : (
        <>
          <div className="project-task-list-columns" aria-hidden="true">
            <span />
            <span>Actividad</span>
            <span>Estado</span>
            <span>Estimación</span>
            <span>Prioridad</span>
            <span>Asignados</span>
            <span>Acciones</span>
          </div>
          <ul className="project-task-list-items">
            {backlogTasks.map((task) => (
              <li key={task.id} className={`project-task-row board-priority-${task.priority}`}>
                <label className="project-task-row-selection">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.has(task.id)}
                    disabled={pending}
                    onChange={(event) => setSelectedTaskIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(task.id);
                      else next.delete(task.id);
                      return next;
                    })}
                    aria-label={`Seleccionar ${task.title}`}
                  />
                </label>
                <div className="task-list-item-main">
                  <div className="project-task-row-title">
                    <button
                      type="button"
                      className="task-list-title"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      {task.title}
                    </button>
                  </div>
                  <p className="task-list-description">{task.description}</p>
                </div>
                <span className="project-task-row-status" title={`Estado: ${columnById.get(task.column_id) ?? "Sin columna"}`}>
                  {columnById.get(task.column_id) ?? "Sin columna"}
                </span>
                <span className="project-task-row-estimate">{formatTaskEstimate(task.estimate_quantity, task.estimate_unit)}</span>
                <span className={`project-task-row-priority project-task-row-priority-${task.priority}`}>{priorityLabel[task.priority]}</span>
                <AssigneeAvatars assignees={task.assignees} className="project-task-row-assignees" />
                <div className="task-list-item-actions">
                  {!readOnly ? (
                    <button
                      type="button"
                      className="secondary-button board-compact-button"
                      disabled={pending}
                      onClick={() => changeSprint(task)}
                    >
                      Agregar al Sprint
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
        </>
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
