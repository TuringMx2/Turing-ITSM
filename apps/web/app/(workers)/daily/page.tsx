import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getTodayCheckin, listDailyCheckins } from "@/app/actions/daily";
import DailyCheckinForm from "./DailyCheckinForm";

export const dynamic = "force-dynamic";

export default async function WorkerDailyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [todayRes, historyRes] = await Promise.all([getTodayCheckin(), listDailyCheckins({ page: 1, pageSize: 20 })]);

  const today = (todayRes.data as unknown as { id: string; q1_yesterday: string; q2_today: string; q3_blockers: string | null; date: string } | null) ?? null;
  const history = (historyRes.data as unknown as { rows: Array<{ id: string; date: string; q1_yesterday: string; q2_today: string; q3_blockers: string | null; created_at: string }>; count: number } | undefined) ?? { rows: [], count: 0 };
  const listError = historyRes.error;

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div>
          <p className="eyebrow">Workers</p>
          <h1 style={{ margin: "4px 0 8px" }}>Daily check-in</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Share what you completed, what you plan today, and any blockers. Your entries are visible only to you and admins (RLS-enforced).
          </p>
        </div>

        <DailyCheckinForm today={today} />

        <section className="card" style={{ display: "grid", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Your history</h2>
            <p className="muted small-text" style={{ margin: "4px 0 0" }}>Most recent 20 entries, newest first. Only your check-ins are listed (RLS-aware).</p>
          </div>

          {listError ? <p className="form-error">{listError}</p> : null}

          {history.rows.length === 0 ? (
            <p className="muted">No entries yet. Save today&apos;s check-in to start your history.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #d7deea" }}>
                    <th style={{ padding: "10px 8px" }}>Date (UTC)</th>
                    <th style={{ padding: "10px 8px" }}>Yesterday</th>
                    <th style={{ padding: "10px 8px" }}>Today</th>
                    <th style={{ padding: "10px 8px" }}>Blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid #eef2f7" }}>
                      <td style={{ padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 600 }}>{row.date}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q1_yesterday}>{row.q1_yesterday}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q2_today}>{row.q2_today}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q3_blockers ?? ""}>{row.q3_blockers ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small-text" style={{ margin: "12px 0 0" }}>Total: {history.count ?? history.rows.length}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
