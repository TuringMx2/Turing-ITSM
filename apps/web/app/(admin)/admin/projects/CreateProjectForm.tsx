"use client";

import { useState, useTransition } from "react";
import { createProject } from "@/app/actions/projects";
import { useRouter } from "next/navigation";

export default function CreateProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setError("Name must be 2-100 characters.");
      return;
    }
    if (description.trim().length > 1000) {
      setError("Description must be at most 1000 characters.");
      return;
    }
    startTransition(async () => {
      const res = await createProject({ teamId, name: trimmedName, description: description.trim() || null });
      if (res.error) setError(res.error);
      else {
        setSuccess("Project created.");
        setName("");
        setDescription("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Create project</h2>
      <p className="muted small-text" style={{ margin: 0 }}>Superadmin-only. RLS enforces tenant-scoped administrator access.</p>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>Name *</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="e.g. Customer Onboarding" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea" }} />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} placeholder="Optional, up to 1000 chars" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "inherit", resize: "vertical" }} />
        <span className="muted small-text">{description.length}/1000</span>
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {success ? <p style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 10, padding: 12, margin: 0 }}>{success}</p> : null}
      <button type="submit" className="primary-button" disabled={pending}>{pending ? "Creating…" : "Create project"}</button>
    </form>
  );
}
