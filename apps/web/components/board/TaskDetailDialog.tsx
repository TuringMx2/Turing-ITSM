"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createTaskComment,
  deleteTaskAttachment,
  getTaskAttachmentDownloadUrl,
  getTaskDetails,
  updateTask,
  uploadTaskAttachment,
  type BoardColumn,
  type BoardTask,
  type ProjectMemberOption,
  type TaskDetail,
} from "@/app/actions/tasks";
import { formatTaskEstimate, type TaskEstimateUnit } from "@/lib/task-estimate";
import { AssigneePicker } from "./AssigneePicker";
import { useModalFocus } from "./use-modal-focus";

const kibibyteFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 0,
});

export function TaskDetailDialog({
  taskId,
  columns,
  members,
  readOnly,
  onClose,
  onChanged,
}: {
  taskId: string;
  columns: BoardColumn[];
  members: ProjectMemberOption[];
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [estimateQuantity, setEstimateQuantity] = useState("");
  const [estimateUnit, setEstimateUnit] = useState<TaskEstimateUnit>("hours");
  const [priority, setPriority] = useState<BoardTask["priority"]>("medium");
  const [columnId, setColumnId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  const savedAssignees = detail?.task.assignee_ids ?? [];
  const hasFieldChanges = Boolean(
    detail &&
      (title !== detail.task.title ||
        description !== detail.task.description ||
        estimateQuantity !== (detail.task.estimate_quantity?.toString() ?? "") ||
        estimateUnit !== (detail.task.estimate_unit ?? "hours") ||
        priority !== detail.task.priority ||
        columnId !== detail.task.column_id ||
        [...assigneeIds].sort().join(",") !== [...savedAssignees].sort().join(","))
  );

  function requestClose() {
    if (pending) return;
    if ((hasFieldChanges || comment.trim()) && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    onClose();
  }

  const dialogRef = useModalFocus<HTMLElement>(requestClose);

  const load = useCallback(async () => {
    const result = await getTaskDetails(taskId);
    if (result.error || !result.data) {
      setDetail(null);
      setError(result.error ?? "No se pudieron cargar los detalles de la tarea. Intentá nuevamente.");
      setLoading(false);
      return;
    }
    const next = result.data;
    setDetail(next);
    setTitle(next.task.title);
    setDescription(next.task.description);
    setEstimateQuantity(next.task.estimate_quantity?.toString() ?? "");
    setEstimateUnit(next.task.estimate_unit ?? "hours");
    setPriority(next.task.priority);
    setColumnId(next.task.column_id);
    setAssigneeIds(next.task.assignee_ids);
    setError(null);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    let active = true;
    void getTaskDetails(taskId).then((result) => {
      if (!active) return;
      if (result.error || !result.data) {
        setDetail(null);
        setError(result.error ?? "No se pudieron cargar los detalles de la tarea. Intentá nuevamente.");
        setLoading(false);
        return;
      }
      const next = result.data;
      setDetail(next);
      setTitle(next.task.title);
      setDescription(next.task.description);
      setEstimateQuantity(next.task.estimate_quantity?.toString() ?? "");
      setEstimateUnit(next.task.estimate_unit ?? "hours");
      setPriority(next.task.priority);
      setColumnId(next.task.column_id);
      setAssigneeIds(next.task.assignee_ids);
      setError(null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setError(null);
    startTransition(async () => {
      const result = await updateTask({
        taskId,
        columnId,
        title,
        description,
        estimateQuantity,
        estimateUnit,
        priority,
        assigneeIds,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      await load();
      onChanged();
    });
  }

  function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setError(null);
    startTransition(async () => {
      const result = await createTaskComment({ taskId, body: comment });
      if (result.error) {
        setError(result.error);
        return;
      }
      setComment("");
      await load();
      onChanged();
    });
  }

  function uploadAttachment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Seleccioná un archivo para subir.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Los archivos no pueden superar los 10 MiB.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadTaskAttachment(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      form.reset();
      await load();
      onChanged();
    });
  }

  function removeAttachment(attachmentId: string) {
    if (readOnly) return;
    if (!window.confirm("¿Eliminar este archivo adjunto?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTaskAttachment({ attachmentId });
      if (result.error) {
        setError(result.error);
        return;
      }
      await load();
      onChanged();
    });
  }

  function downloadAttachment(attachmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await getTaskAttachmentDownloadUrl({ attachmentId });
      if (result.error || !result.data) {
        setError(result.error ?? "No se pudo crear el enlace de descarga. Intentá nuevamente.");
        return;
      }
      window.location.assign(result.data.signedUrl);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      className="board-dialog-backdrop board-dialog-backdrop-detail"
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section className="board-dialog board-detail-dialog" aria-busy={loading || pending} ref={dialogRef}>
        <header className="board-dialog-header">
          <div>
            <p className="eyebrow">Colaboración de tareas</p>
            <h2 id="task-detail-title">{detail?.task.title ?? "Detalles de la tarea"}</h2>
          </div>
          <button type="button" onClick={requestClose} disabled={pending} aria-label="Cerrar detalles de la tarea" className="board-dialog-close">×</button>
        </header>

        {loading ? <p className="empty-state" aria-live="polite" aria-busy="true">Cargando detalles de la tarea…</p> : null}
        {error ? <p className="form-error" role="status" aria-live="polite">{error}</p> : null}
        {readOnly ? (
          <p className="empty-state board-notice">
            Esta tarea archivada es de solo lectura. El historial de colaboración y las descargas siguen disponibles.
          </p>
        ) : null}

        {detail ? (
          <>
            <form onSubmit={saveTask} className="admin-form" aria-label="Campos de la tarea">
              <h3>Campos de la tarea</h3>
              <p className="muted small-text">Estimación actual: {formatTaskEstimate(detail.task.estimate_quantity, detail.task.estimate_unit)}</p>
              <label><span>Título</span><input data-autofocus name="title" autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} disabled={readOnly || pending} /></label>
              <label><span>Descripción</span><textarea name="description" autoComplete="off" value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={8000} rows={5} disabled={readOnly || pending} /></label>
              <div className="board-field-grid board-field-grid-three">
                <label><span>Estimación</span><input name="estimateQuantity" type="number" inputMode="decimal" min="0.01" max="99999999.99" step="0.01" autoComplete="off" value={estimateQuantity} onChange={(event) => setEstimateQuantity(event.target.value)} required disabled={readOnly || pending} /></label>
                <label><span>Unidad</span><select name="estimateUnit" autoComplete="off" value={estimateUnit} onChange={(event) => setEstimateUnit(event.target.value as TaskEstimateUnit)} disabled={readOnly || pending}><option value="hours">Horas</option><option value="days">Días</option></select></label>
                <label><span>Prioridad</span><select name="priority" autoComplete="off" value={priority} onChange={(event) => setPriority(event.target.value as BoardTask["priority"])} disabled={readOnly || pending}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
                <label><span>Columna</span><select name="columnId" autoComplete="off" value={columnId} onChange={(event) => setColumnId(event.target.value)} required disabled={readOnly || pending}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
              </div>
              <fieldset disabled={readOnly || pending} className="board-assignees">
                <legend>Personas asignadas</legend>
                {members.length === 0 ? <p className="muted small-text">No hay integrantes disponibles.</p> : <AssigneePicker members={members} selectedIds={assigneeIds} onChange={setAssigneeIds} disabled={readOnly || pending} />}
              </fieldset>
              {!readOnly ? <button type="submit" className="primary-button board-submit-button" disabled={pending}>{pending ? "Guardando…" : "Guardar tarea"}</button> : null}
            </form>

            <div className="card-grid two-columns board-detail-grid">
              <section className="card board-detail-panel">
                <h3>Comentarios</h3>
                {detail.comments.length === 0 ? <p className="empty-state">Todavía no hay comentarios.</p> : <ul className="member-list board-ledger-list">{detail.comments.map((item) => <li key={item.id} className="board-ledger-entry"><strong>{item.author_name}</strong><span className="board-entry-body">{item.body}</span><small className="muted"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("es-ES")}</time></small></li>)}</ul>}
                {!readOnly ? <form onSubmit={addComment} className="admin-form board-subform"><label><span>Agregar comentario</span><textarea name="comment" autoComplete="off" value={comment} onChange={(event) => setComment(event.target.value)} required maxLength={8000} rows={3} /></label><button type="submit" disabled={pending} className="primary-button">Agregar comentario</button></form> : null}
              </section>

              <section className="card board-detail-panel">
                <h3>Archivos adjuntos</h3>
                <p className="muted small-text">Archivos privados de hasta 10 MiB. Los enlaces de descarga vencen después de 60 segundos.</p>
                {detail.attachments.length === 0 ? <p className="empty-state">No hay archivos adjuntos.</p> : <ul className="member-list board-ledger-list">{detail.attachments.map((attachment) => <li key={attachment.id} className="board-ledger-entry"><strong className="board-file-name">{attachment.file_name}</strong><span className="muted small-text">{kibibyteFormatter.format(Math.ceil(attachment.size_bytes / 1024))} KiB · {attachment.uploader_name}</span><div className="board-entry-actions"><button type="button" className="secondary-button board-compact-button" disabled={pending} onClick={() => downloadAttachment(attachment.id)}>Descargar archivo</button>{!readOnly ? <button type="button" className="secondary-button board-compact-button board-danger-button" disabled={pending} onClick={() => removeAttachment(attachment.id)}>Eliminar archivo</button> : null}</div></li>)}</ul>}
                {!readOnly ? <form onSubmit={uploadAttachment} className="admin-form board-subform" encType="multipart/form-data"><label><span>Subir archivo</span><input type="file" name="file" required /></label><button type="submit" disabled={pending} className="primary-button">{pending ? "Procesando…" : "Subir archivo"}</button></form> : null}
              </section>
            </div>

            <section className="card board-detail-panel">
              <h3>Actividad</h3>
              {detail.activity.length === 0 ? <p className="empty-state">No hay actividad registrada.</p> : <ul className="permission-list board-activity-list">{detail.activity.map((item) => <li key={item.id}><strong>{item.actor_name}</strong> · {item.action.replaceAll("_", " ")} · <time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString("es-ES")}</time></li>)}</ul>}
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
