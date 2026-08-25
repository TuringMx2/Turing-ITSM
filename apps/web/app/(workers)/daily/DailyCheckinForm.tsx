"use client";

import { useState, useTransition } from "react";
import { createDailyCheckin, updateDailyCheckin } from "@/app/actions/daily";
import { useRouter } from "next/navigation";

type TodayRow = {
  id: string;
  q1_yesterday: string;
  q2_today: string;
  q3_blockers: string | null;
  date: string;
} | null;

export default function DailyCheckinForm({ today }: { today: TodayRow }) {
  const router = useRouter();
  const [q1, setQ1] = useState(today?.q1_yesterday ?? "");
  const [q2, setQ2] = useState(today?.q2_today ?? "");
  const [q3, setQ3] = useState(today?.q3_blockers ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEditing = !!today;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!q1.trim() || !q2.trim()) {
      setError("Please complete the two required questions.");
      return;
    }
    if (q1.length > 1000 || q2.length > 1000 || q3.length > 1000) {
      setError("Each field must be 1-1000 characters.");
      return;
    }

    startTransition(async () => {
      // Use createDailyCheckin upsert; if editing and we have id, we can also use update path for strict same-day semantics
      let res: { error?: string; data?: unknown };
      if (isEditing && today?.id) {
        res = await updateDailyCheckin({
          id: today.id,
          q1Yesterday: q1.trim(),
          q2Today: q2.trim(),
          q3Blockers: q3.trim() || null,
        });
        // If update fails because of time-boundary, fallback to create (race already handled server)
        if (res.error && res.error.includes("Can only edit")) {
          res = await createDailyCheckin({
            q1Yesterday: q1.trim(),
            q2Today: q2.trim(),
            q3Blockers: q3.trim() || null,
          });
        }
      } else {
        res = await createDailyCheckin({
          q1Yesterday: q1.trim(),
          q2Today: q2.trim(),
          q3Blockers: q3.trim() || null,
        });
      }

      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(isEditing ? "Check-in updated." : "Check-in saved.");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: "grid", gap: 16 }}>
      <div>
        <p className="eyebrow">Daily check-in — {new Date().toISOString().slice(0, 10)} UTC</p>
        <h2 style={{ margin: "4px 0 0" }}>{isEditing ? "Update today's check-in" : "What did you do today?"}</h2>
        <p className="muted small-text" style={{ margin: "8px 0 0" }}>
          One entry per day. Editing allowed until 23:59 UTC. RLS enforces ownership.
        </p>
      </div>

      <label style={{ display: "grid", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          1. What did you do yesterday? *
        </span>
        <textarea
          value={q1}
          onChange={(e) => setQ1(e.target.value)}
          rows={3}
          maxLength={1000}
          required
          placeholder="Yesterday I..."
          style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "inherit", resize: "vertical" }}
        />
        <span className="muted small-text">{q1.length}/1000</span>
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          2. What will you do today? *
        </span>
        <textarea
          value={q2}
          onChange={(e) => setQ2(e.target.value)}
          rows={3}
          maxLength={1000}
          required
          placeholder="Today I will..."
          style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "inherit", resize: "vertical" }}
        />
        <span className="muted small-text">{q2.length}/1000</span>
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          3. Blockers / impediments (optional)
        </span>
        <textarea
          value={q3}
          onChange={(e) => setQ3(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="No blockers / waiting on..."
          style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #d7deea", fontFamily: "inherit", resize: "vertical" }}
        />
        <span className="muted small-text">{q3.length}/1000</span>
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {success ? <p style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 10, padding: 12, margin: 0 }}>{success}</p> : null}

      <button type="submit" className="primary-button" disabled={isPending}>
        {isPending ? "Saving…" : isEditing ? "Update check-in" : "Save check-in"}
      </button>
    </form>
  );
}
