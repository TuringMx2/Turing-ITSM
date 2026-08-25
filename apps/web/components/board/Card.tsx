"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@turing-itsm/types";

export type BoardTask = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Task["status"];
  priority: Task["priority"];
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

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

export function Card({
  task,
  onDelete,
  isAdmin,
}: {
  task: BoardTask;
  onDelete?: (taskId: string) => void;
  isAdmin?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 12,
    display: "grid",
    gap: 6,
    cursor: "grab",
    boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.12)" : "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, lineHeight: 1.3, flex: 1 }}>{task.title}</p>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#fff",
            background: priorityColor[task.priority] ?? "#64748b",
            borderRadius: 999,
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {priorityLabel[task.priority] ?? task.priority}
        </span>
      </div>
      {task.description ? (
        <p style={{ margin: 0, fontSize: 12, color: "#475569", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {task.description}
        </p>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
          {task.assignee_id ? `assignee ${task.assignee_id.slice(0, 8)}…` : "unassigned"}
        </span>
        {isAdmin && onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            style={{
              fontSize: 11,
              color: "#dc2626",
              background: "transparent",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
