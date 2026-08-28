"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardTask } from "@/app/actions/tasks";

export type { BoardTask };

const priorityLabel: Record<BoardTask["priority"], string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const dueDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

export function Card({
  task,
  onDelete,
  onOpen,
  disabled = false,
  readOnly = false,
}: {
  task: BoardTask;
  onDelete?: (taskId: string) => void;
  onOpen?: (taskId: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: disabled || readOnly,
  });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={`board-task-card board-priority-${task.priority}${isDragging ? " board-task-card-dragging" : ""}`}
    >
      <header className="board-task-header">
        <button
          type="button"
          disabled={disabled || readOnly}
          {...attributes}
          {...listeners}
          aria-label={`Arrastrar la tarea ${task.title}`}
          className="board-task-handle"
        >
          {task.title}
        </button>
        <span className="board-priority-badge">
          {priorityLabel[task.priority]}
        </span>
      </header>
      <p className="board-task-description">
        {task.description}
      </p>
      <p className="muted small-text board-task-meta">
        Vence <time dateTime={task.due_date}>{dueDateFormatter.format(new Date(`${task.due_date}T00:00:00Z`))}</time> · {task.assignees.length > 0
          ? task.assignees.map((assignee) => assignee.full_name || assignee.email).join(", ")
          : "Sin asignar"}
      </p>
      <footer className="board-task-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpen?.(task.id)}
          className="board-card-action"
          aria-label={`Abrir detalles de ${task.title}`}
        >
          Ver detalles
        </button>
        {!readOnly ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDelete?.(task.id)}
            className="board-card-action board-danger-button"
            aria-label={`Eliminar la tarea ${task.title}`}
          >
            Eliminar
          </button>
        ) : null}
      </footer>
    </article>
  );
}
