import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/auth";
import { getProject } from "@/app/actions/projects";
import { getTaskBoard } from "@/app/actions/tasks";
import { Board } from "@/components/board/Board";
import { AppShell } from "@/components/app-shell";
import { isSuperAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { projectId: string };

export default async function AdminProjectBoardPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  const user = await getCurrentInternalUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.role)) redirect("/workspace/dashboard");

  const projectRes = await getProject(projectId);
  if (projectRes.error) return notFound();
  const project = projectRes.data as unknown as { id: string; name: string; description: string | null; created_at: string };

  const boardResult = await getTaskBoard(projectId);
  const board = boardResult.data;

  return (
    <AppShell moduleSlug="projects" user={user}>
      <section className="module-page page-stack board-page board-page-admin">
        <header className="page-header board-page-header">
          <div>
            <p className="eyebrow">Administración · Tablero</p>
            <h1>{project.name}</h1>
            <p className="muted small-text page-description">{project.description || "Sin descripción"}</p>
          </div>
          <Link href="/projects" className="secondary-button board-page-back-link">
            Volver a proyectos
          </Link>
        </header>

        <section className="card board-page-workspace" aria-labelledby="board-page-title">
          <header className="section-heading board-page-toolbar">
            <h2 id="board-page-title">Tareas</h2>
            {board ? <span className="count-pill task-count">{board.tasks.length}</span> : null}
            {board ? (
              <span className="muted small-text board-page-status">
                {board.readOnly ? "Proyecto archivado · solo lectura" : "Proyecto activo"}
              </span>
            ) : null}
          </header>
          {boardResult.error ? <p className="form-error board-page-error" role="alert">No pudimos cargar el tablero. {boardResult.error}</p> : null}
          {board ? (
            <Board
              key={JSON.stringify([board.columns, board.tasks, board.members, board.readOnly])}
              projectId={project.id}
              initialColumns={board.columns}
              initialTasks={board.tasks}
              members={board.members}
              readOnly={board.readOnly}
            />
          ) : null}
          <p className="muted small-text board-page-help">
            Gestioná los accesos del proyecto desde Roles y permisos.
          </p>
        </section>

        <section className="card project-members" aria-labelledby="project-members-title">
          <header className="section-heading project-members-header">
            <h2 id="project-members-title">Integrantes</h2>
            <span className="count-pill project-member-count">{board?.members.length ?? 0}</span>
          </header>
          {!board || board.members.length === 0 ? (
            <p className="empty-state project-members-empty" role="status">
              Este proyecto todavía no tiene integrantes. Agregalos desde la lista de proyectos.
            </p>
          ) : (
            <ul className="member-list project-member-list">
              {board.members.map((member) => (
                <li key={member.id}>{member.full_name || member.email}</li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </AppShell>
  );
}
