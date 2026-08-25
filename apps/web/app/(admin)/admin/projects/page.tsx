import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listProjects, listMembers } from "@/app/actions/projects";
import CreateProjectForm from "./CreateProjectForm";
import AddMemberForm, { MembersList } from "./AddMemberForm";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/workspace/dashboard");

  const res = await listProjects({ page: 1, pageSize: 50 });
  const data = res.data as unknown as { rows: Array<{ id: string; name: string; description: string | null; created_at: string; created_by: string }>; count: number } | undefined;
  const rows = data?.rows ?? [];
  const error = res.error;

  // Prefetch members for each project (sequential for simplicity; small pageSize)
  const membersByProject = new Map<string, Array<{ user_id: string; created_at: string }>>();
  for (const p of rows) {
    const mRes = await listMembers(p.id);
    if (!mRes.error && mRes.data) {
      membersByProject.set(p.id, mRes.data as unknown as Array<{ user_id: string; created_at: string }>);
    } else {
      membersByProject.set(p.id, []);
    }
  }

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div>
          <p className="eyebrow">Admin · Workers</p>
          <h1 style={{ margin: "4px 0 8px" }}>Projects</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 700 }}>
            Admin manages projects and team membership. Workers only see projects they belong to (RLS-scoped listing). Board will be added in T8.
          </p>
        </div>

        <CreateProjectForm />

        {error ? <p className="form-error">{error}</p> : null}

        <section className="card" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>All projects · {data?.count ?? rows.length}</h2>
            <span className="muted small-text">{rows.length} shown (page 1)</span>
          </div>

          {rows.length === 0 ? (
            <p className="muted">No projects yet. Create one above.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {rows.map((p) => {
                const members = membersByProject.get(p.id) ?? [];
                return (
                  <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15 }}>{p.name}</h3>
                        <p className="muted small-text" style={{ margin: "4px 0 0", maxWidth: 520 }}>{p.description || "No description"}</p>
                        <p className="muted small-text" style={{ margin: "4px 0 0", fontFamily: "monospace", fontSize: 11 }}>ID {p.id} · created {new Date(p.created_at).toLocaleDateString()}</p>
                      </div>
                      <Link href={`/admin/projects/${p.id}/board`} className="primary-link" style={{ height: 36, padding: "0 14px", fontSize: 13, alignSelf: "start" }}>
                        Open board
                      </Link>
                    </div>

                    <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>Members ({members.length})</p>
                      <MembersList projectId={p.id} initialMembers={members} />
                      <AddMemberForm projectId={p.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
