"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { updateTaskStatus, deleteTask } from "@/app/actions/tasks";
import { useRouter } from "next/navigation";
import { Column } from "./Column";
import { Card, type BoardTask } from "./Card";
import { CreateCardDialog } from "./CreateCardDialog";

const STATUSES = ["todo", "doing", "done", "blocked"] as const;

export function Board({
  projectId,
  initialTasks,
  isAdmin,
}: {
  projectId: string;
  initialTasks: BoardTask[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogStatus, setDialogStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const t of tasks) {
      const bucket = map.get(t.status) ?? [];
      bucket.push(t);
      map.set(t.status, bucket);
    }
    return map;
  }, [tasks]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeTaskId = active.id as string;
    const overId = over.id as string;

    const dragged = tasks.find((t) => t.id === activeTaskId);
    if (!dragged) return;

    // Determine new status: if overId is a column id, use it; else find task's status
    let newStatus: string | null = null;
    if ((STATUSES as readonly string[]).includes(overId)) {
      newStatus = overId;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) newStatus = overTask.status;
    }

    if (!newStatus || newStatus === dragged.status) return;

    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === activeTaskId ? { ...t, status: newStatus as BoardTask["status"] } : t)));

    startTransition(async () => {
      const res = await updateTaskStatus({ taskId: activeTaskId, status: newStatus as BoardTask["status"] });
      if (res.error) {
        // Revert on RLS / error
        setTasks((prev) => prev.map((t) => (t.id === activeTaskId ? { ...t, status: dragged.status } : t)));
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete(taskId: string) {
    if (!confirm("Delete this card? Admin only.")) return;
    setError(null);
    // Optimistic removal
    const prev = tasks;
    setTasks((p) => p.filter((t) => t.id !== taskId));
    startTransition(async () => {
      const res = await deleteTask({ taskId });
      if (res.error) {
        setTasks(prev);
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleCreated(created: unknown) {
    const task = created as BoardTask;
    // Insert optimistically if not already present
    if (task && typeof task === "object" && "id" in task) {
      setTasks((prev) => {
        if (prev.some((t) => t.id === (task as BoardTask).id)) return prev;
        return [task as BoardTask, ...prev];
      });
    }
    setDialogStatus(null);
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <p style={{ margin: 0, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 10, padding: 10, fontSize: 12 }}>{error}</p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {STATUSES.map((status) => (
            <Column
              key={status}
              id={status}
              tasks={tasksByStatus.get(status) ?? []}
              isAdmin={isAdmin}
              onDeleteTask={handleDelete}
              onCreateClick={(s) => setDialogStatus(s)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div style={{ transform: "rotate(2deg)", width: 280 }}>
              <Card task={activeTask} isAdmin={isAdmin} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {dialogStatus ? (
        <CreateCardDialog
          projectId={projectId}
          defaultStatus={dialogStatus}
          onCreated={handleCreated}
          onClose={() => setDialogStatus(null)}
        />
      ) : null}

      <p className="muted small-text" style={{ margin: 0 }}>
        Drag cards between columns to change status. Priority colors: gray low · blue medium · orange high · red urgent.
      </p>
    </div>
  );
}
