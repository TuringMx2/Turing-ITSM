import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/app/actions/projects";

export const dynamic = "force-dynamic";

export default async function WorkerProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const res = await listProjects({ page: 1, pageSize: 50 });
  const data = res.data as unknown as { rows: Array<{ id: string; name: string; description: string | null; created_at: string }>; count: number } | undefined;
  const rows = data?.rows ?? [];

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div>
          <p className="eyebrow">Workers</p>
          <h1 style={{ margin: "4px 0 8px" }}>My projects</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Projects you belong to. Admin assigns membership; RLS ensures you only see scoped projects. Board access will be enabled in T8.
          </p>
        </div>

        {res.error ? <p className="form-error">{res.error}</p> : null}

        <section className="card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Projects · {data?.count ?? rows.length}</h2>
            {user.role === "admin" ? (
              <Link href="/admin/projects" className="primary-link" style={{ height: 36, padding: "0 14px", fontSize: 13 }}>
                Manage as admin
              </Link>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="muted">No projects assigned yet. Ask an admin to add you to a project.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {rows.map((p) => (
                <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15 }}>{p.name}</h3>
                    <p className="muted small-text" style={{ margin: "4px 0 0", maxWidth: 520 }}>{p.description || "No description"}</p>
                    <p className="muted small-text" style={{ margin: "4px 0 0", fontFamily: "monospace", fontSize: 11 }}>{new Date(p.created_at).toLocaleDateString()}</p>
                  </div>
                  <Link href={`/projects/${p.id}/board`} className="primary-link" style={{ background: "#fff", color: "#172033", border: "1px solid #d7deea", height: 36, padding: "0 14px", fontSize: 13 }}>
                    View board
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="muted small-text" style={{ margin: 0 }}>
          Need to create a project? Contact an admin — only admins can create projects (enforced by RLS and server actions).
        </p>
      </div>
    </main>
  );
}
