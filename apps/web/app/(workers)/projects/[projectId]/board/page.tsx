import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/app/actions/projects";

export const dynamic = "force-dynamic";

type Params = { projectId: string };

export default async function WorkerProjectBoardPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projectRes = await getProject(projectId);
  if (projectRes.error) return notFound();
  const project = projectRes.data as unknown as { id: string; name: string; description: string | null };

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <p className="eyebrow">Project board</p>
            <h1 style={{ margin: "4px 0 4px" }}>{project.name}</h1>
            <p className="muted small-text" style={{ margin: 0 }}>{project.description || "No description"}</p>
          </div>
          <Link href="/projects" className="primary-link" style={{ background: "#fff", color: "#172033", border: "1px solid #d7deea" }}>
            Back to my projects
          </Link>
        </div>

        <section className="card" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Kanban board</h2>
          <p className="muted" style={{ margin: 0 }}>
            Tasks for this project will appear here once T7 (tasks backend) and T8 (board UI with drag-and-drop) land. Membership already verified — RLS ensures only members see this board.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {(["todo", "doing", "done", "blocked"] as const).map((col) => (
              <div key={col} style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 16, minHeight: 120, background: "#f8fafc" }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>{col}</p>
                <p className="muted small-text" style={{ margin: "8px 0 0" }}>Empty until tasks exist.</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
