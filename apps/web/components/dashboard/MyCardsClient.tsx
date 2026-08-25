"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listMyCards } from "@/app/actions/tasks";

const priorityColor: Record<string, string> = {
  low: "#64748b",
  medium: "#2563eb",
  high: "#ea580c",
  urgent: "#dc2626",
};

const priorityLabel: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

type CardRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  description: string | null;
  created_at: string;
};

export function MyCardsClient() {
  const [rows, setRows] = useState<CardRow[]>([]);
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
          const data = res.data as unknown as { rows: CardRow[] };
          setRows(data?.rows ?? []);
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
      <section className="card" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>My cards</h2>
        <p className="muted small-text" style={{ margin: 0 }}>Loading…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card" style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>My cards</h2>
        <p style={{ margin: 0, color: "#dc2626", fontSize: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10 }}>{error}</p>
      </section>
    );
  }

  return (
    <section className="card" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>My cards · {rows.length}</h2>
        <span className="muted small-text">Top 10 by priority</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted small-text" style={{ margin: 0 }}>No cards assigned to you. Ask a project member to assign tasks.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {rows.map((t) => (
            <li key={t.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, display: "grid", gap: 4, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: priorityColor[t.priority] ?? "#64748b", borderRadius: 999, padding: "2px 8px" }}>
                  {priorityLabel[t.priority] ?? t.priority}
                </span>
              </div>
              {t.description ? <span style={{ fontSize: 12, color: "#475569" }}>{t.description.slice(0, 120)}</span> : null}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{t.status} · {new Date(t.created_at).toLocaleDateString()}</span>
                <Link href={`/projects/${t.project_id}/board`} style={{ fontSize: 11, color: "#2563eb", fontWeight: 700, textDecoration: "none" }}>Open board →</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small-text" style={{ margin: 0 }}>Ordered by priority: urgent → high → medium → low. Also available at <Link href="/dashboard" style={{ color: "#2563eb", fontWeight: 700 }}>/dashboard</Link>.</p>
    </section>
  );
}
