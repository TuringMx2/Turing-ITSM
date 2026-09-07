import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/auth";
import { listProjects } from "@/app/actions/projects";
import { AppShell } from "@/components/app-shell";
import { isAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const projectDateFormatter = new Intl.DateTimeFormat("es", { dateStyle: "medium" });

export default async function WorkerProjectsPage() {
  const user = await getCurrentInternalUser();
  if (!user) redirect("/login");

  const res = await listProjects({ page: 1, pageSize: 50 });
  const data = res.data as unknown as { rows: Array<{ id: string; name: string; description: string | null; created_at: string }>; count: number } | undefined;
  const rows = data?.rows ?? [];

  return (
    <AppShell moduleSlug="projects" user={user}>
      <section className="module-page page-stack project-page">
        <header className="page-header project-page-header">
          <div>
            <p className="eyebrow">Proyectos</p>
            <h1>Mis proyectos</h1>
            <p className="muted page-description">
              Accedé a los tableros de los proyectos de los que formás parte.
            </p>
          </div>
        </header>

        {res.error ? (
          <p className="form-error project-error" role="alert">No pudimos cargar tus proyectos. Actualizá la página e intentá nuevamente.</p>
        ) : (
        <section className="card project-directory" aria-labelledby="project-list-title">
          <header className="section-heading project-directory-header">
            <h2 id="project-list-title">Proyectos</h2>
            <span className="count-pill project-count">{data?.count ?? rows.length}</span>
            {isAdmin(user.role) ? (
              <Link href="/workspace/roles-permisos" className="primary-link project-admin-link">
                Administrar accesos
              </Link>
            ) : null}
          </header>

          {rows.length === 0 ? (
            <p className="empty-state project-empty-state" role="status">
              Todavía no tenés proyectos asignados. Contactá a un administrador para solicitar acceso.
            </p>
          ) : (
            <div className="project-list">
              {rows.map((p) => (
                <article key={p.id} className="project-card project-list-item">
                  <div className="project-card-content">
                    <h3 className="project-card-title">{p.name}</h3>
                    <p className="muted small-text project-card-description">{p.description || "Sin descripción"}</p>
                    <time className="muted small-text project-card-date" dateTime={p.created_at}>
                      Creado el {projectDateFormatter.format(new Date(p.created_at))}
                    </time>
                  </div>
                  <Link href={`/projects/${p.id}/board`} className="primary-link project-card-link">
                    Ver tablero
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
        )}

        {!res.error ? <p className="muted small-text project-help-text">
          ¿Necesitás crear un proyecto? Contactá a un administrador.
        </p> : null}
      </section>
    </AppShell>
  );
}
