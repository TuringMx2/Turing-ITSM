"use client";

import { useState, useTransition } from "react";
import { createTask, type BoardTask, type ProjectMemberOption } from "@/app/actions/tasks";
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
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<BoardTask["priority"]>("medium");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isDirty = Boolean(title || description || dueDate || assigneeIds.length || priority !== "medium");

  function requestClose() {
    if (pending) return;
    if (isDirty && !window.confirm("¿Descartar los cambios de esta tarea?")) return;
    onClose();
  }

  const dialogRef = useModalFocus<HTMLFormElement>(requestClose);

  function toggleAssignee(userId: string) {
    setAssigneeIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createTask({
        projectId,
        columnId,
        title,
        description,
        dueDate,
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
        <div className="board-field-grid">
          <label>
            <span>Fecha de vencimiento</span>
            <input name="dueDate" type="date" autoComplete="off" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
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
            members.map((member) => (
              <label key={member.id} className="board-check-option">
                <input type="checkbox" name="assigneeIds" value={member.id} checked={assigneeIds.includes(member.id)} onChange={() => toggleAssignee(member.id)} />
                <span>{member.full_name || member.email}</span>
              </label>
            ))
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
