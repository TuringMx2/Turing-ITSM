"use client";

import { useState, useTransition } from "react";
import { createTask, type BoardTask, type ProjectMemberOption } from "@/app/actions/tasks";
import type { TaskEstimateUnit } from "@/lib/task-estimate";
import { AssigneePicker } from "./AssigneePicker";
import { useModalFocus } from "./use-modal-focus";

export function CreateCardDialog({
  projectId,
  columnId,
  columnName,
  members,
  onCreated,
  onClose,
}: {
  projectId: string;
  columnId: string;
  columnName: string;
  members: ProjectMemberOption[];
  onCreated: (task: BoardTask) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [estimateQuantity, setEstimateQuantity] = useState("");
  const [estimateUnit, setEstimateUnit] = useState<TaskEstimateUnit>("hours");
  const [priority, setPriority] = useState<BoardTask["priority"]>("medium");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [isCurrentSprint, setIsCurrentSprint] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isDirty = Boolean(
    title ||
      description ||
      estimateQuantity ||
      assigneeIds.length ||
      priority !== "medium" ||
      isCurrentSprint !== null,
  );

  function requestClose() {
    if (pending) return;
    if (isDirty && !window.confirm("¿Descartar los cambios de esta tarea?")) return;
    onClose();
  }

  const dialogRef = useModalFocus<HTMLFormElement>(requestClose);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (isCurrentSprint === null) {
      setError("Elegí si la tarea va al Sprint actual o al Backlog.");
      return;
    }
    startTransition(async () => {
      const result = await createTask({
        projectId,
        columnId,
        isCurrentSprint,
        title,
        description,
        estimateQuantity,
        estimateUnit,
        priority,
        assigneeIds,
      });
      if (result.error || !result.data) {
        setError(result.error ?? "No se pudo crear la tarea. Intentá nuevamente.");
        return;
      }
      onCreated(result.data);
      onClose();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-title"
      className="board-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <form onSubmit={handleSubmit} className="admin-form board-dialog" aria-busy={pending} ref={dialogRef}>
        <header className="board-dialog-header">
          <div>
            <p className="eyebrow">Registro de operaciones</p>
            <h2 id="create-task-title">Crear tarea · {columnName}</h2>
          </div>
          <button type="button" onClick={requestClose} disabled={pending} aria-label="Cerrar creación de tarea" className="board-dialog-close">×</button>
        </header>

        <label>
          <span>Título</span>
          <input data-autofocus name="title" autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={1} maxLength={200} />
        </label>
        <label>
          <span>Descripción</span>
          <textarea name="description" autoComplete="off" value={description} onChange={(event) => setDescription(event.target.value)} required minLength={1} maxLength={8000} rows={4} />
        </label>
        <fieldset className="board-assignees create-task-destination">
          <legend>¿Dónde querés crear esta tarea?</legend>
          <label className="board-check-option">
            <input type="radio" name="taskDestination" value="current-sprint" checked={isCurrentSprint === true} onChange={() => setIsCurrentSprint(true)} required />
            <span>Sprint actual</span>
          </label>
          <label className="board-check-option">
            <input type="radio" name="taskDestination" value="backlog" checked={isCurrentSprint === false} onChange={() => setIsCurrentSprint(false)} required />
            <span>Backlog</span>
          </label>
        </fieldset>
        <div className="board-field-grid">
          <label>
            <span>Estimación</span>
            <input name="estimateQuantity" type="number" inputMode="decimal" min="0.01" max="99999999.99" step="0.01" autoComplete="off" value={estimateQuantity} onChange={(event) => setEstimateQuantity(event.target.value)} required />
          </label>
          <label>
            <span>Unidad</span>
            <select name="estimateUnit" autoComplete="off" value={estimateUnit} onChange={(event) => setEstimateUnit(event.target.value as TaskEstimateUnit)}>
              <option value="hours">Horas</option>
              <option value="days">Días</option>
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select name="priority" autoComplete="off" value={priority} onChange={(event) => setPriority(event.target.value as BoardTask["priority"])}>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
        </div>

        <fieldset className="board-assignees">
          <legend>Personas asignadas</legend>
          {members.length === 0 ? (
            <p className="muted small-text">No hay integrantes disponibles. La tarea puede quedar sin asignar.</p>
          ) : (
            <AssigneePicker members={members} selectedIds={assigneeIds} onChange={setAssigneeIds} disabled={pending} />
          )}
        </fieldset>

        {error ? <p className="form-error" role="status" aria-live="polite">{error}</p> : null}
        <footer className="board-dialog-actions">
          <button type="button" onClick={requestClose} disabled={pending} className="secondary-button">Cancelar</button>
          <button type="submit" disabled={pending} className="primary-button">{pending ? "Creando…" : "Crear tarea"}</button>
        </footer>
      </form>
    </div>
  );
}
