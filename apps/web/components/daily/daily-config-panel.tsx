import type { DailyAdminData } from "@/app/actions/daily-runs";
import {
  CreateDailyQuestionForm,
  DeactivateDailyQuestionForm,
  GenerateDailyRunForm,
  TeamDailyConfigurationForm,
} from "./daily-forms";

function teamNameById(data: DailyAdminData, teamId: string): string {
  return data.teams.find((team) => team.id === teamId)?.name ?? "Equipo no disponible";
}

type DailyConfigPanelProps = {
  data: DailyAdminData;
};

export function DailyConfigPanel({ data }: DailyConfigPanelProps) {
  const activeQuestions = data.questions.filter((q) => q.is_active);
  const selectedByTeam = new Map<string, string[]>();
  for (const selection of data.selections) {
    const current = selectedByTeam.get(selection.team_id) ?? [];
    current[selection.position - 1] = selection.question_id;
    selectedByTeam.set(selection.team_id, current);
  }
  const scheduleByTeam = new Map(data.schedules.map((s) => [s.team_id, s]));

  return (
    <div className="daily-config-view" id="daily-configuration-view">
      <div className="daily-admin-grid">
        <section className="card daily-catalog-card">
          <div className="daily-section-heading">
            <div>
              <p className="eyebrow">Catálogo</p>
              <h2>Preguntas Daily</h2>
              <p className="muted small-text">Las preguntas se desactivan; no se eliminan para conservar la evidencia histórica.</p>
            </div>
          </div>
          <CreateDailyQuestionForm />
          {data.questions.length === 0 ? <p className="muted">Todavía no hay preguntas en el catálogo.</p> : null}
          <div className="daily-catalog-list">
            {data.questions.map((question) => (
              <article className="daily-catalog-item" key={question.id}>
                <div>
                  <p>{question.question_text}</p>
                  <span className={question.is_active ? "daily-state active" : "daily-state"}>
                    {question.is_active ? "Activa" : "Desactivada"}
                  </span>
                </div>
                {question.is_active ? <DeactivateDailyQuestionForm questionId={question.id} /> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="card daily-generator-card">
          <p className="eyebrow">Producción manual</p>
          <h2>Generar ejecución</h2>
          <p className="muted small-text">Solo se puede generar para un equipo con horario activo y un día configurado.</p>
          <GenerateDailyRunForm schedules={data.schedules} teams={data.teams} />
        </section>
      </div>

      <section className="daily-configuration-section">
        <div className="daily-section-heading">
          <div>
            <p className="eyebrow">Configuración por equipo</p>
            <h2>Horario y preguntas</h2>
            <p className="muted">La ejecución toma una instantánea de las preguntas activas al momento de generarse.</p>
          </div>
        </div>
        {data.teams.length === 0 ? (
          <section className="card"><p className="muted">Creá un equipo activo en Roles &amp; Permissions para configurar Daily.</p></section>
        ) : (
          <div className="daily-team-grid">
            {data.teams.map((team) => (
              <TeamDailyConfigurationForm
                activeQuestions={activeQuestions}
                key={team.id}
                schedule={scheduleByTeam.get(team.id)}
                selectedQuestionIds={selectedByTeam.get(team.id) ?? []}
                team={team}
              />
            ))}
          </div>
        )}
      </section>

      <section className="daily-visibility-grid">
        <article className="card">
          <div className="daily-section-heading">
            <div>
              <p className="eyebrow">Visibilidad</p>
              <h2>Ejecuciones recientes</h2>
            </div>
          </div>
          {data.runs.length === 0 ? (
            <p className="muted">Todavía no se generaron ejecuciones.</p>
          ) : (
            <ul className="daily-event-list">
              {data.runs.map((run) => (
                <li key={run.id}>
                  {teamNameById(data, run.team_id)} · {run.local_date} ({run.timezone_snapshot})
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}
