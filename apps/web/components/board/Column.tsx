"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardColumn } from "@/app/actions/tasks";
import { Card, type BoardTask } from "./Card";

export function Column({
  column,
  tasks,
  first,
  last,
  pending,
  readOnly,
  onCreateClick,
  onDeleteTask,
  onOpenTask,
  onRename,
  onMove,
  onDeleteColumn,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  first: boolean;
  last: boolean;
  pending: boolean;
  readOnly: boolean;
  onCreateClick: (columnId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onRename: (columnId: string, currentName: string) => void;
  onMove: (columnId: string, direction: "left" | "right") => void;
  onDeleteColumn: (columnId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: readOnly });

  return (
    <section
      ref={setNodeRef}
      className={`board-column${isOver ? " board-column-over" : ""}`}
      aria-labelledby={`board-column-${column.id}`}
      aria-busy={pending}
    >
      <header className="board-column-header">
        <div className="board-column-heading">
          <h3 id={`board-column-${column.id}`} className="board-column-title">{column.name}</h3>
          <span className="board-column-count" aria-label={`${tasks.length} tareas`}>{tasks.length}</span>
          {!readOnly ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onCreateClick(column.id)}
              className="secondary-button board-compact-button"
            >
              Agregar tarea
            </button>
          ) : null}
        </div>
        {!readOnly ? (
          <details className="board-column-menu">
            <summary aria-label={`Más acciones para ${column.name}`}>Más acciones</summary>
            <div className="board-column-toolbar" aria-label={`Acciones de la columna ${column.name}`}>
              <button type="button" className="board-icon-button" disabled={pending || first} onClick={() => onMove(column.id, "left")} aria-label={`Mover ${column.name} a la izquierda`} title="Mover a la izquierda">←</button>
              <button type="button" className="board-icon-button" disabled={pending || last} onClick={() => onMove(column.id, "right")} aria-label={`Mover ${column.name} a la derecha`} title="Mover a la derecha">→</button>
              <button type="button" className="board-text-button" disabled={pending} onClick={() => onRename(column.id, column.name)}>Renombrar</button>
              <button type="button" className="board-text-button board-danger-button" disabled={pending} onClick={() => onDeleteColumn(column.id)}>Eliminar columna</button>
            </div>
          </details>
        ) : null}
      </header>

      <SortableContext id={column.id} items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="board-task-list" aria-label={`Tareas en ${column.name}`}>
          {tasks.length === 0 ? (
            <p className="board-column-empty">
              {readOnly ? "No hay tareas en esta columna" : "Soltá tareas acá"}
            </p>
          ) : (
            tasks.map((task) => (
              <Card
                key={task.id}
                task={task}
                onDelete={onDeleteTask}
                onOpen={onOpenTask}
                disabled={pending}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}
