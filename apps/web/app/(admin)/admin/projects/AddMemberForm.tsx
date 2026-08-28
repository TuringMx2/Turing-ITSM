"use client";

import { useState, useTransition } from "react";
import { addMember } from "@/app/actions/projects";
import { useRouter } from "next/navigation";

export default function AddMemberForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Lightweight UUID v4 check
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = userId.trim();
    if (!isUuid(trimmed)) {
      setError("User ID must be a valid UUID.");
      return;
    }
    startTransition(async () => {
      const res = await addMember({ projectId, userId: trimmed });
      if (res.error) setError(res.error);
      else {
        setSuccess("Member added.");
        setUserId("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
      <label style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
        <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Add member (user UUID)</span>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d7deea", fontFamily: "monospace", fontSize: 12 }}
        />
      </label>
      <button type="submit" className="primary-button" style={{ height: 36, padding: "0 14px", fontSize: 13 }} disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      {error ? <span style={{ color: "#dc2626", fontSize: 12, width: "100%" }}>{error}</span> : null}
      {success ? <span style={{ color: "#065f46", fontSize: 12, width: "100%" }}>{success}</span> : null}
    </form>
  );
}

export function MembersList({ initialMembers }: { initialMembers: Array<{ user_id: string; created_at: string }> }) {
  // This is a simple read-only display; superadmins can see membership via server fetch.
  // For interactivity, we could fetch via listMembers but SSR already provides data.
  if (initialMembers.length === 0) return <p className="muted small-text" style={{ margin: "8px 0 0" }}>No members yet.</p>;
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#475569" }}>
      {initialMembers.map((m) => (
        <li key={m.user_id} style={{ fontFamily: "monospace" }}>{m.user_id} <span style={{ fontFamily: "sans-serif", color: "#94a3b8" }}>· {new Date(m.created_at).toLocaleDateString()}</span></li>
      ))}
    </ul>
  );
}
