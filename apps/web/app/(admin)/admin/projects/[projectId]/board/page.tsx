import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProject, listMembers } from "@/app/actions/projects";

export const dynamic = "force-dynamic";

type Params = { projectId: string };

export default async function AdminProjectBoardPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/workspace/dashboard");

  const projectRes = await getProject(projectId);
  if (projectRes.error) return notFound();
  const project = projectRes.data as unknown as { id: string; name: string; description: string | null; created_at: string };

  const membersRes = await listMembers(projectId);
  const members = (membersRes.data as unknown as Array<{ user_id: string; created_at: string }>) ?? [];

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <p className="eyebrow">Admin · Project board</p>
            <h1 style={{ margin: "4px 0 4px" }}>{project.name}</h1>
            <p className="muted small-text" style={{ margin: 0 }}>{project.description || "No description"} · {members.length} member(s)</p>
          </div>
          <Link href="/admin/projects" className="primary-link" style={{ background: "#fff", color: "#172033", border: "1px solid #d7deea" }}>
            Back to projects
          </Link>
        </div>

        <section className="card" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Kanban board</h2>
          <p className="muted" style={{ margin: 0 }}>
            Board with drag-and-drop columns (todo / doing / done / blocked) will be implemented in T7–T8. This wrapper verifies routing, membership check, and RLS scope for admin.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {(["todo", "doing", "done", "blocked"] as const).map((col) => (
              <div key={col} style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 16, minHeight: 120, background: "#f8fafc" }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>{col}</p>
                <p className="muted small-text" style={{ margin: "8px 0 0" }}>Cards appear here when tasks exist.</p>
              </div>
            ))}
          </div>
          <p className="muted small-text" style={{ margin: 0 }}>
            Project ID <span style={{ fontFamily: "monospace" }}>{project.id}</span> · Use Admin Projects page to manage members before T7 tasks backend lands.
          </p>
        </section>

        <section className="card" style={{ display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Members</h3>
          {members.length === 0 ? (
            <p className="muted small-text" style={{ margin: 0 }}>No members. Add from the projects list.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {members.map((m) => (
                <li key={m.user_id} style={{ fontFamily: "monospace" }}>{m.user_id}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
