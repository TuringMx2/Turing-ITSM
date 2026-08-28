"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DailyAdminData, DailyRunRow } from "@/app/actions/daily-runs";
import {
  CreateDailyQuestionForm,
  DeactivateDailyQuestionForm,
  GenerateDailyRunForm,
  TeamDailyConfigurationForm,
} from "./daily-forms";
import { DailySubmissionReport } from "./daily-submission-report";

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const localDateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function teamNameById(data: DailyAdminData, teamId: string): string {
  return data.teams.find((team) => team.id === teamId)?.name ?? "Equipo no disponible";
}

function runLabel(run: DailyRunRow, teamName?: string): string {
  const localDate = localDateFormatter.format(new Date(`${run.local_date}T00:00:00Z`));
  return `${teamName ? `${teamName} · ` : ""}${localDate} · vence ${formatDateTime(run.due_at)} (${run.timezone_snapshot})`;
}

type DailyAdminViewProps = {
  data: DailyAdminData;
};

export function DailyAdminView({ data }: DailyAdminViewProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const showingConfiguration = searchParams.get("dailyView") === "config";

  function toggleView() {
    const params = new URLSearchParams(searchParams.toString());
    if (showingConfiguration) params.delete("dailyView");
    else params.set("dailyView", "config");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const activeQuestions = data.questions.filter((q) => q.is_active);
  const selectedByTeam = new Map<string, string[]>();
  for (const selection of data.selections) {
    const current = selectedByTeam.get(selection.team_id) ?? [];
    current[selection.position - 1] = selection.question_id;
    selectedByTeam.set(selection.team_id, current);
  }
  const scheduleByTeam = new Map(data.schedules.map((s) => [s.team_id, s]));
  return (
    <section className="module-page daily-page">
      <header className="daily-page-header">
        <div>
          <p className="eyebrow">Admin · Daily</p>
          <h1>{showingConfiguration ? "Configuración de Daily" : "Respuestas del equipo"}</h1>
          <p className="muted">
            {showingConfiguration
              ? "Administrá preguntas, horarios y ejecuciones por equipo."
              : "Revisá las actualizaciones enviadas durante los últimos 7 días."}
          </p>
        </div>
        <div className="daily-header-actions">
          <div className="daily-page-signal" aria-label="Resumen Daily">
            <span>{data.submissions.length} envíos</span>
            <span>{data.runs.length} ejecuciones</span>
          </div>
          <button
            className={showingConfiguration ? "daily-config-button active" : "daily-config-button"}
            aria-controls={showingConfiguration ? "daily-configuration-view" : "daily-responses-view"}
            aria-pressed={showingConfiguration}
            onClick={toggleView}
            type="button"
          >
            <span aria-hidden="true">{showingConfiguration ? "←" : "⚙"}</span>
            {showingConfiguration ? "Ver respuestas" : "Configuración"}
          </button>
        </div>
      </header>

      {!showingConfiguration ? (
        <div className="daily-responses-view" id="daily-responses-view">
          <DailySubmissionReport
            answers={data.submissionAnswers}
            people={data.people}
            submissionRuns={data.submissionRuns}
            submissions={data.submissions}
            teams={data.reportTeams}
          />
        </div>
      ) : (
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
              {data.runs.length === 0 ? <p className="muted">Todavía no se generaron ejecuciones.</p> : (
                <ul className="daily-event-list">
                  {data.runs.map((run) => <li key={run.id}>{runLabel(run, teamNameById(data, run.team_id))}</li>)}
                </ul>
              )}
            </article>
          </section>
        </div>
      )}
    </section>
  );
}
