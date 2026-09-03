import Link from "next/link";
import type { DailyMemberData } from "@/app/actions/daily-runs";
import { DailyCompletionChecklist } from "@/components/daily/daily-completion-checklist";
import { DailyResponseForm } from "@/components/daily/daily-forms";
import { DailyPlanTaskEntry } from "@/components/daily/daily-plan-task-entry";
import { DailyPhaseRefresh } from "@/components/daily/daily-phase-refresh";

function TeamSelector({ teams }: { teams: Array<{ id: string; name: string }> }) {
  return (
    <form action="/workspace/dashboard" className="dashboard-daily-team-form" method="get">
      <label>
        <span>Equipo Daily</span>
        <select name="dailyTeam" required>
          <option disabled value="">Seleccioná un equipo…</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="submit">Ver equipo</button>
    </form>
  );
}

export function DashboardDailyCard({ result }: { result: { data?: DailyMemberData; error?: string } }) {
  const data = result.data;
  if (!data) {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <Link className="task-card-link" href="/workspace/daily">Abrir Daily →</Link>
        </header>
        <p className="form-error dashboard-error" role="alert">No pudimos cargar Daily. {result.error}</p>
      </section>
    );
  }

  const workspace = data.taskWorkspace;
  if (workspace.status === "select_team") {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <span className="count-pill">Equipo requerido</span>
        </header>
        <p className="muted">Tus tareas y ejecuciones se mantienen separadas por equipo.</p>
        <TeamSelector teams={workspace.teamOptions} />
      </section>
    );
  }

  if (workspace.status === "unavailable") {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <Link className="task-card-link" href="/workspace/daily">Abrir Daily →</Link>
        </header>
        <p className="form-error dashboard-error" role="alert">{workspace.message}</p>
      </section>
    );
  }

  const todayPendingRuns = data.pendingRuns.filter((run) => run.local_date === workspace.localDate);

  return (
    <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
      <DailyPhaseRefresh timezoneName={workspace.timezoneName} />
      <header className="dashboard-widget-header">
        <div>
          <p className="eyebrow">{workspace.teamName}</p>
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
        </div>
        <Link className="task-card-link" href={`/workspace/daily?dailyTeam=${workspace.teamId}`}>Abrir Daily →</Link>
      </header>
      {workspace.phase === "planning" ? (
        todayPendingRuns.length > 0 ? (
          <DailyResponseForm localDate={workspace.localDate!} pendingRuns={todayPendingRuns} runQuestions={data.runQuestions} />
        ) : (
          <>
            <p className="muted">No hay una ejecución Daily pendiente para hoy. Podés sumar tareas a tu plan.</p>
            <DailyPlanTaskEntry teamId={workspace.teamId!} tasks={workspace.tasks} />
          </>
        )
      ) : workspace.completionSubmitted ? (
        <p className="action-message success" role="status">Ya registraste el cierre Daily de hoy.</p>
      ) : workspace.tasks.length > 0 ? (
        <DailyCompletionChecklist logicalDate={workspace.localDate!} tasks={workspace.tasks} teamId={workspace.teamId!} />
      ) : (
        <p className="empty-state">No hay tareas planificadas para cerrar hoy.</p>
      )}
      {workspace.yesterdayCompletedTasks.length > 0 ? (
        <div className="daily-yesterday-evidence">
          <p className="eyebrow">Ayer · evidencia de trabajo terminado</p>
          <ul className="daily-task-list">
            {workspace.yesterdayCompletedTasks.map((task) => <li key={task.id}>{task.title}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
