"use client";

import { useMemo, useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import {
  createWorkflowColumn,
  deleteTask,
  deleteWorkflowColumn,
  moveTask,
  renameWorkflowColumn,
  reorderWorkflowColumn,
  type BoardColumn,
  type BoardTask,
  type ProjectMemberOption,
} from "@/app/actions/tasks";
import { Card } from "./Card";
import { Column } from "./Column";
import { CreateCardDialog } from "./CreateCardDialog";
import { TaskDetailDialog } from "./TaskDetailDialog";

export function BoardCreateTaskButton({
  projectId,
  columns,
  members,
  readOnly,
  onCreated,
}: {
  projectId: string;
  columns: BoardColumn[];
  members: ProjectMemberOption[];
  readOnly: boolean;
  onCreated?: (task: BoardTask) => void;
}) {
  const router = useRouter();
  const [createColumnId, setCreateColumnId] = useState<string | null>(null);
  const defaultColumn = useMemo(
    () => [...columns].sort((left, right) => left.position - right.position)[0],
    [columns],
  );
  const createColumn = columns.find((column) => column.id === createColumnId);

  if (readOnly) return null;

  return (
    <>
      <button
        type="button"
        className="primary-button"
        disabled={!defaultColumn}
        onClick={() => setCreateColumnId(defaultColumn.id)}
      >
        Agregar tarea
      </button>
      {createColumn ? (
        <CreateCardDialog
          projectId={projectId}
          columnId={createColumn.id}
          columnName={createColumn.name}
          members={members}
          onCreated={(task) => {
            onCreated?.(task);
            router.refresh();
          }}
          onClose={() => setCreateColumnId(null)}
        />
      ) : null}
    </>
  );
}

export function Board({
  projectId,
  initialColumns,
  initialTasks,
  members,
  readOnly,
}: {
  projectId: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  members: ProjectMemberOption[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createColumnId, setCreateColumnId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const orderedColumns = useMemo(
    () => [...columns].sort((left, right) => left.position - right.position),
    [columns],
  );
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const column of orderedColumns) map.set(column.id, []);
    for (const task of tasks) {
      const bucket = map.get(task.column_id) ?? [];
      bucket.push(task);
      map.set(task.column_id, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (left, right) =>
          left.position - right.position || right.updated_at.localeCompare(left.updated_at),
      );
    }
    return map;
  }, [orderedColumns, tasks]);
  const activeTask = activeId ? tasks.find((task) => task.id === activeId) ?? null : null;
  const createColumn = orderedColumns.find((column) => column.id === createColumnId);

  function handleDragStart(event: DragStartEvent) {
    if (pending || readOnly) return;
    setActiveId(String(event.active.id));
    setError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (pending || readOnly || !event.over) return;
    const taskId = String(event.active.id);
    const overId = String(event.over.id);
    const dragged = tasks.find((task) => task.id === taskId);
    if (!dragged || overId === taskId) return;
    const overTask = tasks.find((task) => task.id === overId);
    const targetColumnId = overTask?.column_id ?? columns.find((column) => column.id === overId)?.id;
    if (!targetColumnId) return;

    const previous = tasks;
    const orderedTargetBeforeMove = previous
      .filter((task) => task.column_id === targetColumnId)
      .sort(
        (left, right) =>
          left.position - right.position || right.updated_at.localeCompare(left.updated_at),
      );
    const remaining = previous.filter((task) => task.id !== taskId);
    const targetTasks = remaining
      .filter((task) => task.column_id === targetColumnId)
      .sort((left, right) => left.position - right.position);
    const overIndex = overTask
      ? orderedTargetBeforeMove.findIndex((task) => task.id === overTask.id)
      : targetTasks.length;
    const targetIndex = overIndex < 0 ? targetTasks.length : overIndex;
    targetTasks.splice(targetIndex, 0, { ...dragged, column_id: targetColumnId });
    const sourceTasks = remaining
      .filter((task) => task.column_id === dragged.column_id)
      .sort((left, right) => left.position - right.position);
    const positionById = new Map<string, { columnId: string; position: number }>();
    sourceTasks.forEach((task, index) => {
      positionById.set(task.id, { columnId: dragged.column_id, position: index * 1024 });
    });
    targetTasks.forEach((task, index) => {
      positionById.set(task.id, { columnId: targetColumnId, position: index * 1024 });
    });
    const next = previous.map((task) => {
      const desired = positionById.get(task.id);
      return desired
        ? { ...task, column_id: desired.columnId, position: desired.position }
        : task;
    });
    setTasks(next);
    setError(null);

    startTransition(async () => {
      const result = await moveTask({ taskId, targetColumnId, targetIndex });
      if (result.error) {
        setTasks(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDeleteTask(taskId: string) {
    if (readOnly) return;
    if (!window.confirm("¿Eliminar esta tarea? Primero quitá sus archivos adjuntos. También se eliminarán los comentarios y las asignaciones.")) return;
    const previous = tasks;
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setError(null);
    startTransition(async () => {
      const result = await deleteTask({ taskId });
      if (result.error) {
        setTasks(previous);
        setError(result.error);
        return;
      }
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      router.refresh();
    });
  }

  function handleCreateColumn(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setError(null);
    startTransition(async () => {
      const result = await createWorkflowColumn({ projectId, name: newColumnName });
      if (result.error || !result.data) {
        setError(result.error ?? "No se pudo crear la columna. Intentá nuevamente.");
        return;
      }
      setColumns((current) => [...current, result.data!]);
      setNewColumnName("");
      router.refresh();
    });
  }

  function handleRenameColumn(columnId: string, currentName: string) {
    if (readOnly) return;
    const name = window.prompt("Nombre de la columna", currentName)?.trim();
    if (!name || name === currentName) return;
    const previous = columns;
    setColumns((current) => current.map((column) => column.id === columnId ? { ...column, name } : column));
    setError(null);
    startTransition(async () => {
      const result = await renameWorkflowColumn({ columnId, name });
      if (result.error) {
        setColumns(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleMoveColumn(columnId: string, direction: "left" | "right") {
    if (readOnly) return;
    const previous = columns;
    const ordered = [...orderedColumns];
    const index = ordered.findIndex((column) => column.id === columnId);
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    setColumns(ordered.map((column, position) => ({ ...column, position })));
    setError(null);
    startTransition(async () => {
      const result = await reorderWorkflowColumn({ columnId, direction });
      if (result.error) {
        setColumns(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDeleteColumn(columnId: string) {
    if (readOnly) return;
    if (!window.confirm("¿Eliminar esta columna vacía? Las tareas nunca se mueven automáticamente.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteWorkflowColumn({ columnId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setColumns((current) => current.filter((column) => column.id !== columnId));
      router.refresh();
    });
  }

  return (
    <section className="board-root" aria-label="Tablero de operaciones" aria-busy={pending}>
      {readOnly ? (
        <p className="empty-state board-notice">
          Este proyecto está archivado. El historial de tareas sigue disponible, pero los cambios están deshabilitados.
        </p>
      ) : (
        <form onSubmit={handleCreateColumn} className="admin-form board-column-form" aria-label="Agregar columna">
          <label htmlFor="board-new-column" className="board-visually-hidden">Nombre de la nueva columna</label>
          <input id="board-new-column" name="columnName" autoComplete="off" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} required minLength={1} maxLength={80} placeholder="Nueva columna…" />
          <button type="submit" disabled={pending} className="secondary-button">Agregar columna</button>
        </form>
      )}
      <p className="board-visually-hidden" aria-live="polite">{pending ? "Actualizando el tablero…" : ""}</p>
      {error ? <p className="form-error" role="status" aria-live="polite">{error}</p> : null}
      {orderedColumns.length === 0 ? (
        <p className="empty-state">
          {readOnly ? "Este proyecto no conserva columnas de flujo." : "Todavía no hay columnas. Agregá la primera arriba."}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="board-columns">
            {orderedColumns.map((column, index) => (
              <Column
                key={column.id}
                column={column}
                tasks={tasksByColumn.get(column.id) ?? []}
                first={index === 0}
                last={index === orderedColumns.length - 1}
                pending={pending}
                readOnly={readOnly}
                onCreateClick={setCreateColumnId}
                onDeleteTask={handleDeleteTask}
                onOpenTask={setSelectedTaskId}
                onRename={handleRenameColumn}
                onMove={handleMoveColumn}
                onDeleteColumn={handleDeleteColumn}
              />
            ))}
          </div>
          <DragOverlay>{activeTask ? <div className="board-drag-overlay"><Card task={activeTask} disabled /></div> : null}</DragOverlay>
        </DndContext>
      )}

      <p className="muted small-text board-help">
        {readOnly
          ? "Los campos, comentarios, archivos adjuntos y la actividad archivados están disponibles como referencia."
          : "Mové tareas con arrastre o usando el teclado desde el título de cada tarjeta. Las columnas con tareas no se pueden eliminar."}
      </p>

      {createColumn && !readOnly ? (
        <CreateCardDialog
          projectId={projectId}
          columnId={createColumn.id}
          columnName={createColumn.name}
          members={members}
          onCreated={(task) => {
            if (task.is_current_sprint) setTasks((current) => [...current, task]);
          }}
          onClose={() => setCreateColumnId(null)}
        />
      ) : null}
      {selectedTaskId ? (
        <TaskDetailDialog
          taskId={selectedTaskId}
          columns={orderedColumns}
          members={members}
          readOnly={readOnly}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}
