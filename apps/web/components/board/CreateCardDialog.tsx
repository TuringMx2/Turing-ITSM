"use client";

import { useState, useTransition } from "react";
import { createTask } from "@/app/actions/tasks";

export function CreateCardDialog({
  projectId,
  defaultStatus,
  onCreated,
  onClose,
}: {
  projectId: string;
  defaultStatus: string;
  onCreated?: (task: unknown) => void;
  onClose?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
      setError("Title must be 1-200 characters.");
      return;
    }
    if (description.trim().length > 2000) {
      setError("Description must be at most 2000 characters.");
      return;
    }
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    if (assigneeId.trim() && !isUuid(assigneeId.trim())) {
      setError("Assignee must be a valid UUID or leave empty.");
      return;
    }

    startTransition(async () => {
      const res = await createTask({
        projectId,
        title: trimmedTitle,
        description: description.trim() || null,
        status: defaultStatus as "todo" | "doing" | "done" | "blocked",
        priority,
        assigneeId: assigneeId.trim() || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setTitle("");
      setDescription("");
      setAssigneeId("");
      onCreated?.(res.data);
      onClose?.();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          width: "min(520px, 100%)",
          display: "grid",
          gap: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Create card · {defaultStatus}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Title *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            placeholder="e.g. Fix login flow"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Optional details, up to 2000 chars"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "inherit", resize: "vertical" }}
          />
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{description.length}/2000</span>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea" }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Assignee (UUID)</span>
            <input
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              placeholder="optional"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "monospace", fontSize: 12 }}
            />
          </label>
        </div>

        {error ? <p style={{ margin: 0, color: "#dc2626", fontSize: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10 }}>{error}</p> : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #d7deea", background: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            Cancel
          </button>
          <button type="submit" disabled={pending} className="primary-button" style={{ padding: "10px 16px", borderRadius: 10 }}>
            {pending ? "Creating…" : "Create card"}
          </button>
        </div>
      </form>
    </div>
  );
}
