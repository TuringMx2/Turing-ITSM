import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/auth";
import { getProject } from "@/app/actions/projects";
import { getTaskBoard } from "@/app/actions/tasks";
import { ProjectTasksWorkspace } from "@/components/board/ProjectTasksWorkspace";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

type Params = { projectId: string };

export default async function WorkerProjectBoardPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  const user = await getCurrentInternalUser();
  if (!user) redirect("/login");

  const projectRes = await getProject(projectId);
  if (projectRes.error) return notFound();
  const project = projectRes.data as unknown as { id: string; name: string; description: string | null };

  const boardResult = await getTaskBoard(projectId);
  const board = boardResult.data;

  return (
    <AppShell moduleSlug="projects" user={user}>
      <section className="module-page page-stack board-page">
        <header className="page-header board-page-header">
          <div>
            <p className="eyebrow">Tablero del proyecto</p>
            <h1>{project.name}</h1>
            <p className="muted small-text page-description">{project.description || "Sin descripción"}</p>
          </div>
          <Link href="/projects" className="secondary-button board-page-back-link">
            Volver a mis proyectos
          </Link>
        </header>

        <section className="card board-page-workspace" aria-labelledby="project-tasks-title">
          {boardResult.error ? <p className="form-error board-page-error" role="alert">No pudimos cargar el tablero. {boardResult.error}</p> : null}
          {board ? (
            <ProjectTasksWorkspace
              key={JSON.stringify([board.columns, board.tasks, board.allTasks, board.members, board.readOnly])}
              projectId={projectId}
              columns={board.columns}
              currentSprintTasks={board.tasks}
              allTasks={board.allTasks}
              members={board.members}
              readOnly={board.readOnly}
            />
          ) : null}
          <p className="muted small-text board-page-help">
            {board?.readOnly
              ? "Podés consultar el historial, pero no realizar cambios."
              : "Gestioná tareas, responsables, comentarios y archivos desde este tablero."}
          </p>
        </section>
      </section>
    </AppShell>
  );
}
