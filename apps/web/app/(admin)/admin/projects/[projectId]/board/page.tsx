import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProject, listMembers } from "@/app/actions/projects";
import { listTasks } from "@/app/actions/tasks";
import { Board } from "@/components/board/Board";

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

  const tasksRes = await listTasks({ projectId, page: 1, pageSize: 100 });
  const tasksData = tasksRes.data as unknown as { rows: Array<{ id: string; project_id: string; title: string; description: string | null; status: "todo" | "doing" | "done" | "blocked"; priority: "low" | "medium" | "high" | "urgent"; assignee_id: string | null; created_by: string; created_at: string; updated_at: string }> } | undefined;
  const tasks = tasksData?.rows ?? [];
  const tasksError = tasksRes.error;

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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Kanban board · {tasks.length} card(s)</h2>
            <span className="muted small-text">Drag cards between columns — calls updateTaskStatus. Admin can delete cards.</span>
          </div>
          {tasksError ? (
            <p style={{ margin: 0, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 10, padding: 10, fontSize: 12 }}>{tasksError}</p>
          ) : null}
          <Board projectId={project.id} initialTasks={tasks as unknown as never} isAdmin />
          <p className="muted small-text" style={{ margin: 0 }}>
            Project ID <span style={{ fontFamily: "monospace" }}>{project.id}</span> · Use Admin Projects page to manage members. Create cards with “+ Add” per column.
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
