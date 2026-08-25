import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listDailyCheckins } from "@/app/actions/daily";

export const dynamic = "force-dynamic";

type SearchParams = {
  date?: string;
  page?: string;
  userId?: string;
};

export default async function AdminDailyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/workspace/dashboard");

  const date = params.date?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;

  // Validate date format if present
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  const res = await listDailyCheckins({ date: validDate, page, pageSize });
  const data = res.data as unknown as { rows: Array<{ id: string; user_id: string; date: string; q1_yesterday: string; q2_today: string; q3_blockers: string | null; created_at: string }>; count: number; page: number; pageSize: number } | undefined;

  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div>
          <p className="eyebrow">Admin · Workers</p>
          <h1 style={{ margin: "4px 0 8px" }}>Team daily check-ins</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 700 }}>
            Review daily stand-ups across the team. Filter by date to see who checked in. RLS + server-action scoping ensures only admins see all entries.
          </p>
        </div>

        <form method="GET" className="card" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>Date (UTC)</span>
            <input
              type="date"
              name="date"
              defaultValue={validDate ?? ""}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d7deea" }}
            />
          </label>
          <button type="submit" className="primary-button" style={{ height: 42 }}>Filter</button>
          {validDate ? (
            <Link href="/admin/daily" className="primary-link" style={{ background: "#fff", color: "#172033", border: "1px solid #d7deea", height: 42 }}>
              Clear
            </Link>
          ) : null}
        </form>

        {res.error ? <p className="form-error">{res.error}</p> : null}

        <section className="card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Results {count > 0 ? `· ${count} total` : ""}</h2>
            <span className="muted small-text">Page {page} / {totalPages}</span>
          </div>

          {rows.length === 0 ? (
            <p className="muted">{validDate ? `No check-ins for ${validDate}.` : "No check-ins found. Try a different filter or check that workers have submitted today."}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #d7deea" }}>
                    <th style={{ padding: "10px 8px" }}>Date</th>
                    <th style={{ padding: "10px 8px" }}>User</th>
                    <th style={{ padding: "10px 8px" }}>Yesterday</th>
                    <th style={{ padding: "10px 8px" }}>Today</th>
                    <th style={{ padding: "10px 8px" }}>Blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid #eef2f7" }}>
                      <td style={{ padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 600 }}>{row.date}</td>
                      <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 12 }} title={row.user_id}>{row.user_id.slice(0, 8)}…</td>
                      <td style={{ padding: "10px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q1_yesterday}>{row.q1_yesterday}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q2_today}>{row.q2_today}</td>
                      <td style={{ padding: "10px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.q3_blockers ?? ""}>{row.q3_blockers ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
              {page > 1 ? (
                <Link
                  href={`/admin/daily?${new URLSearchParams({ ...(validDate ? { date: validDate } : {}), page: String(page - 1) }).toString()}`}
                  className="primary-link"
                  style={{ background: "#fff", color: "#172033", border: "1px solid #d7deea" }}
                >
                  Previous
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link
                  href={`/admin/daily?${new URLSearchParams({ ...(validDate ? { date: validDate } : {}), page: String(page + 1) }).toString()}`}
                  className="primary-link"
                >
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
