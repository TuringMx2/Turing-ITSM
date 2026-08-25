"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card, type BoardTask } from "./Card";

const columnLabels: Record<string, string> = {
  todo: "To Do",
  doing: "Doing",
  done: "Done",
  blocked: "Blocked",
};

export function Column({
  id,
  tasks,
  isAdmin,
  onDeleteTask,
  onCreateClick,
}: {
  id: string;
  tasks: BoardTask[];
  isAdmin?: boolean;
  onDeleteTask?: (taskId: string) => void;
  onCreateClick?: (status: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        border: isOver ? "2px solid #3b82f6" : "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
        minHeight: 220,
        background: isOver ? "#eff6ff" : "#f8fafc",
        display: "grid",
        gap: 10,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#334155" }}>
          {columnLabels[id] ?? id} · {tasks.length}
        </p>
        {onCreateClick ? (
          <button
            type="button"
            onClick={() => onCreateClick(id)}
            style={{
              fontSize: 11,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            + Add
          </button>
        ) : null}
      </div>

      <SortableContext id={id} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div style={{ display: "grid", gap: 10, minHeight: 40 }}>
          {tasks.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
              Drop cards here
            </p>
          ) : (
            tasks.map((task) => <Card key={task.id} task={task} isAdmin={isAdmin} onDelete={onDeleteTask} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
