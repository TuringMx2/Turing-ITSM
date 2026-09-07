"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listMyCards, type MyCardRow } from "@/app/actions/tasks";
import { formatTaskEstimate } from "@/lib/task-estimate";

const priorityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};
export function MyCardsClient() {
  const [rows, setRows] = useState<MyCardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listMyCards({ page: 1, pageSize: 10 });
        if (cancelled) return;
        if (res.error) setError(res.error);
        else {
          setRows(res.data?.rows ?? []);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="card dashboard-cards-widget" aria-labelledby="dashboard-cards-title" aria-busy="true">
        <h2 id="dashboard-cards-title" className="dashboard-widget-title">Mis tareas</h2>
        <p className="muted small-text dashboard-loading" role="status" aria-live="polite">Cargando tareas…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card dashboard-cards-widget" aria-labelledby="dashboard-cards-title">
        <h2 id="dashboard-cards-title" className="dashboard-widget-title">Mis tareas</h2>
        <p className="form-error dashboard-error" role="alert">No pudimos cargar tus tareas. {error}</p>
      </section>
    );
  }

  return (
    <section className="card dashboard-cards-widget" aria-labelledby="dashboard-cards-title">
      <header className="dashboard-widget-header">
        <h2 id="dashboard-cards-title" className="dashboard-widget-title">Mis tareas</h2>
        <span className="count-pill dashboard-task-count">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="empty-state dashboard-empty-state" role="status">
          No tenés tareas asignadas. Cuando te asignen una, aparecerá acá.
        </p>
      ) : (
        <ul className="dashboard-task-list">
          {rows.map((t) => (
            <li key={t.id} className="task-card dashboard-task-card">
              <div className="task-card-header">
                <strong className="task-card-title">{t.title}</strong>
                <span className={`task-priority task-priority-${t.priority}`}>
                  {priorityLabel[t.priority] ?? t.priority}
                </span>
              </div>
              {t.description ? <p className="muted small-text task-card-description">{t.description.slice(0, 120)}</p> : null}
              <div className="task-card-footer">
                <span className="muted small-text task-card-meta">{t.column_name} · {formatTaskEstimate(t.estimate_quantity, t.estimate_unit)}</span>
                <Link className="task-card-link" href={`/projects/${t.project_id}/board`}>Abrir tablero →</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
