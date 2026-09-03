"use client";

import { useCallback, useMemo, useState } from "react";
import { isAdmin, type InternalRole } from "@/lib/rbac";
import type {
  DailyAdminData,
  DailyMemberData,
  DailySubmissionAnswerRow,
  DailyTeamRow,
} from "@/app/actions/daily-runs";
import { DailyCompletionChecklist } from "./daily-completion-checklist";
import { DailyPlanTaskEntry } from "./daily-plan-task-entry";
import { Dialog, useDialogClose } from "@/components/admin/dialog";
import { DailyResponseForm } from "./daily-forms";
import { DailyResponsesByQuestion } from "./daily-responses-by-question";
import { DailyConfigPanel } from "./daily-config-panel";
import { DailyPhaseRefresh } from "./daily-phase-refresh";

const dayLabelFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function DialogCloseButton({ label = "Cancelar" }: { label?: string }) {
  const close = useDialogClose();
  return (
    <button className="secondary-button" onClick={() => close?.()} type="button">
      {label}
    </button>
  );
}

function DailyTeamSelector({
  teams,
  action,
  selectedTeamId,
}: {
  teams: DailyTeamRow[];
  action: string;
  selectedTeamId?: string;
}) {
  return (
    <form action={action} className="daily-team-context-form" method="get">
      <label>
        <span>Equipo Daily</span>
        <select defaultValue={selectedTeamId ?? ""} name="dailyTeam" required>
          <option disabled value="">Seleccioná un equipo…</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="submit">Ver equipo</button>
    </form>
  );
}

function ReadonlyAnswers({ answers }: { answers: DailySubmissionAnswerRow[] }) {
  const ordered = Array.from(new Set(answers.map((answer) => answer.question_text)));
  return (
    <dl className="daily-answer-list">
      {ordered.map((questionText) => {
        const answerText = answers.find((answer) => answer.question_text === questionText)?.answer_text ?? "";
        return (
          <div className="daily-answer-item" key={questionText}>
            <dt>{questionText}</dt>
            <dd>{answerText}</dd>
          </div>
        );
      })}
    </dl>
  );
}

type DailyExperienceProps = {
  role: InternalRole;
  data: DailyAdminData | DailyMemberData;
};

export function DailyExperience({ role, data }: DailyExperienceProps) {
  const hasAdminAccess = isAdmin(role);
  const adminData = hasAdminAccess ? (data as DailyAdminData) : null;

  const submissions = data.submissions;
  const submissionRuns = data.submissionRuns;
  const submissionAnswers = data.submissionAnswers;
  const people = data.people;
  const reportTeams = data.reportTeams;
  const currentUserId = data.currentUserId;
  const pendingRuns = data.pendingRuns;
  const runQuestions = data.runQuestions;
  const taskWorkspace = "taskWorkspace" in data ? data.taskWorkspace : undefined;

  const [teamFilter, setTeamFilter] = useState<string>(taskWorkspace?.teamId ?? "all");
  const [showingConfig, setShowingConfig] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"respond" | "readonly">("respond");
  const [respondNonce, setRespondNonce] = useState(0);

  const todayKey = taskWorkspace?.localDate ?? "";
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);

  const days = useMemo(() => {
    if (!todayKey) return [];
    const todayUtc = new Date(`${todayKey}T00:00:00Z`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayUtc);
      date.setUTCDate(todayUtc.getUTCDate() - (6 - index));
      return date;
    });
  }, [todayKey]);
  const teamIdsBySubmission = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const linkedRun of submissionRuns) {
      const teamIds = result.get(linkedRun.submission_id) ?? new Set<string>();
      teamIds.add(linkedRun.team_id);
      result.set(linkedRun.submission_id, teamIds);
    }
    return result;
  }, [submissionRuns]);
  const submissionIdsForDate = useMemo(
    () => new Set(
      selectedDate
        ? submissionRuns
            .filter((linkedRun) => linkedRun.local_date === selectedDate)
            .map((linkedRun) => linkedRun.submission_id)
        : submissions.map((submission) => submission.id),
    ),
    [submissionRuns, selectedDate, submissions],
  );

  const selectedDateObj = selectedDate ? (days.find((date) => utcDateKey(date) === selectedDate) ?? new Date(`${selectedDate}T00:00:00Z`)) : null;
  const longDateLabel = selectedDateObj ? longDateFmt.format(selectedDateObj) : "los últimos 7 días";

  const submissionsForDate = useMemo(
    () =>
      submissions.filter(
        (submission) =>
          submissionIdsForDate.has(submission.id) &&
          (teamFilter === "all" || teamIdsBySubmission.get(submission.id)?.has(teamFilter)),
      ),
    [submissions, submissionIdsForDate, teamFilter, teamIdsBySubmission],
  );

  const mySubmissionForDate = submissionsForDate.find((submission) => submission.user_id === currentUserId);

  const pendingRunsForDate = useMemo(
    () => pendingRuns.filter((run) => run.local_date === selectedDate && (teamFilter === "all" || run.team_id === teamFilter)),
    [pendingRuns, selectedDate, teamFilter],
  );
  const pendingRunIdsForDate = useMemo(
    () => new Set(pendingRunsForDate.map((run) => run.id)),
    [pendingRunsForDate],
  );
  const runQuestionsForDate = useMemo(
    () => runQuestions.filter((question) => pendingRunIdsForDate.has(question.run_id)),
    [runQuestions, pendingRunIdsForDate],
  );

  const responseTeamId = teamFilter === "all" ? undefined : teamFilter;
  const responsePendingRuns = useMemo(
    () => responseTeamId ? pendingRunsForDate.filter((run) => run.team_id === responseTeamId) : [],
    [pendingRunsForDate, responseTeamId],
  );
  const responseRunIds = useMemo(() => new Set(responsePendingRuns.map((run) => run.id)), [responsePendingRuns]);
  const responseRunQuestions = useMemo(
    () => runQuestionsForDate.filter((question) => responseRunIds.has(question.run_id)),
    [responseRunIds, runQuestionsForDate],
  );
  const hasResponded = Boolean(mySubmissionForDate);
  const canRespond = responsePendingRuns.length > 0;
  const needsTeamSelection = hasAdminAccess && taskWorkspace?.status === "select_team";

  const answeredCount = useMemo(
    () => new Set(submissionsForDate.map((submission) => submission.user_id)).size,
    [submissionsForDate],
  );
  const teamResponderCount = useMemo(() => {
    const scoped =
      teamFilter === "all"
        ? submissions
        : submissions.filter((submission) => teamIdsBySubmission.get(submission.id)?.has(teamFilter));
    return new Set(scoped.map((submission) => submission.user_id)).size;
  }, [submissions, teamFilter, teamIdsBySubmission]);
  const progressRatio = teamResponderCount === 0 ? 0 : Math.min(1, answeredCount / teamResponderCount);

  const orderedQuestionTexts = useMemo(() => {
    if (!adminData || teamFilter === "all") return undefined;
    const selection = adminData.selections
      .filter((entry) => entry.team_id === teamFilter)
      .sort((left, right) => left.position - right.position);
    return selection
      .map((entry) => adminData.questions.find((question) => question.id === entry.question_id)?.question_text)
      .filter((text): text is string => Boolean(text));
  }, [adminData, teamFilter]);

  const firstDayKey = days.length > 0 ? utcDateKey(days[0]) : "";
  const lastDayKey = days.length > 0 ? utcDateKey(days[days.length - 1]) : "";
  const atStart = !selectedDate || selectedDate <= firstDayKey;
  const atEnd = !selectedDate || selectedDate >= lastDayKey;

  function shiftDate(delta: number) {
    if (days.length === 0) return;
    const index = days.findIndex((date) => utcDateKey(date) === selectedDate);
    const baseIndex = index === -1 ? days.length - 1 : index;
    const nextIndex = Math.min(Math.max(baseIndex + delta, 0), days.length - 1);
    setSelectedDate(utcDateKey(days[nextIndex]));
  }

  function openModal() {
    if (!hasResponded && !canRespond) return;
    setModalMode(hasResponded ? "readonly" : "respond");
    setRespondNonce((value) => value + 1);
    setModalOpen(true);
  }

  const handleRespondSuccess = useCallback(() => {
    setModalOpen(false);
  }, []);

  const ctaLabel = hasResponded ? "Ver mis respuestas" : "Responder Daily";
  const ctaDisabled = !hasResponded && !canRespond;
  const responseHint = needsTeamSelection
    ? "Seleccioná un equipo para ver tus tareas y responder Daily."
    : pendingRunsForDate.length > 0 && !canRespond
      ? "Seleccioná un solo equipo para responder Daily."
      : "No hay una ejecución pendiente para este día.";

  const emptyState = submissionsForDate.length === 0;

  const modalTitle = modalMode === "respond" ? "Responder Daily" : "Tus respuestas del Daily";
  const modalDescription =
    modalMode === "respond"
      ? `Respondé las preguntas de la ejecución del ${longDateLabel}.`
      : `Estas son las respuestas que enviaste para el ${longDateLabel}.`;

  const readonlyAnswers = mySubmissionForDate
    ? submissionAnswers.filter((answer) => answer.submission_id === mySubmissionForDate.id)
    : [];

  const taskForSelectedDate = taskWorkspace?.localDate === selectedDate;

  return (
    <section className="module-page daily-page daily-experience">
      <DailyPhaseRefresh timezoneName={taskWorkspace?.timezoneName} />
      <header className="daily-hero">
        <div className="daily-hero-intro">
          <p className="eyebrow">Daily</p>
          <h1>Daily</h1>
          <p className="muted">Seguimiento diario del equipo</p>
          <p className="daily-hero-date" aria-label="Fecha seleccionada">{longDateLabel}</p>
        </div>
        <div className="daily-hero-actions">
          {hasAdminAccess ? (
            <button
              className={showingConfig ? "daily-config-button active" : "daily-config-button"}
              aria-pressed={showingConfig}
              onClick={() => setShowingConfig((value) => !value)}
              type="button"
            >
              <span aria-hidden="true">{showingConfig ? "←" : "⚙"}</span>
              {showingConfig ? "Volver al Daily" : "Configurar Daily"}
            </button>
          ) : null}
          <button
            className="primary-button daily-respond-cta"
            disabled={ctaDisabled}
            onClick={openModal}
            type="button"
          >
            {ctaLabel}
          </button>
        </div>
      </header>

      {ctaDisabled ? <p className="muted small-text daily-cta-hint">{responseHint}</p> : null}

      {!showingConfig ? (
        <>
          {days.length > 0 ? <nav className="daily-day-nav" aria-label="Navegación por día">
            <button
              aria-label="Día anterior"
              className="daily-day-nav-arrow"
              disabled={atStart}
              onClick={() => shiftDate(-1)}
              type="button"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="filter-segment daily-day-segment" role="group" aria-label="Últimos 7 días">
              {days.map((date) => {
                const key = utcDateKey(date);
                const active = key === selectedDate;
                return (
                  <button
                    aria-pressed={active}
                    className={active ? "daily-day-pill active" : "daily-day-pill"}
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    type="button"
                  >
                    <span className="daily-day-pill-date">{dayLabelFmt.format(date).toUpperCase()}</span>
                    <span className="daily-day-pill-weekday">{weekdayFmt.format(date).replace(".", "")}</span>
                  </button>
                );
              })}
            </div>
            <button
              aria-label="Día siguiente"
              className="daily-day-nav-arrow"
              disabled={atEnd}
              onClick={() => shiftDate(1)}
              type="button"
            >
              <span aria-hidden="true">›</span>
            </button>
          </nav> : null}

          {taskWorkspace?.status === "select_team" ? (
            <section className="card daily-team-context-card">
              <p className="eyebrow">Contexto requerido</p>
              <h2>Seleccioná un equipo</h2>
              <p className="muted">Tus ejecuciones y tareas Daily se mantienen separadas por equipo.</p>
              <DailyTeamSelector action="/workspace/daily" teams={taskWorkspace.teamOptions} />
            </section>
          ) : taskWorkspace?.status === "unavailable" ? (
            <section className="card daily-team-context-card">
              <p className="eyebrow">Daily</p>
              <h2>El plan no está disponible</h2>
              <p className="muted">{taskWorkspace.message}</p>
            </section>
          ) : taskWorkspace && taskForSelectedDate ? (
            <section className="card daily-task-workspace">
              <header className="daily-task-workspace-header">
                <div>
                  <p className="eyebrow">{taskWorkspace.teamName}</p>
                  <h2>Trabajo de hoy</h2>
                </div>
                {taskWorkspace.teamOptions.length > 1 ? (
                  <DailyTeamSelector action="/workspace/daily" selectedTeamId={taskWorkspace.teamId} teams={taskWorkspace.teamOptions} />
                ) : null}
              </header>
              {taskWorkspace.phase === "planning" ? (
                <DailyPlanTaskEntry teamId={taskWorkspace.teamId!} tasks={taskWorkspace.tasks} />
              ) : taskWorkspace.completionSubmitted ? (
                <p className="action-message success" role="status">Ya registraste el cierre Daily de hoy.</p>
              ) : taskWorkspace.tasks.length > 0 ? (
                <DailyCompletionChecklist logicalDate={taskWorkspace.localDate!} tasks={taskWorkspace.tasks} teamId={taskWorkspace.teamId!} />
              ) : (
                <p className="empty-state">No hay tareas planificadas para cerrar hoy.</p>
              )}
              {taskWorkspace.yesterdayCompletedTasks.length > 0 ? (
                <div className="daily-yesterday-evidence">
                  <p className="eyebrow">Ayer · evidencia de trabajo terminado</p>
                  <ul className="daily-task-list">
                    {taskWorkspace.yesterdayCompletedTasks.map((task) => <li key={task.id}>{task.title}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {reportTeams.length > 1 ? (
            <div className="daily-filter-bar daily-team-filter">
              <div className="filter-segment" role="group" aria-label="Filtrar por equipo">
                <button
                  aria-pressed={teamFilter === "all"}
                  className={teamFilter === "all" ? "active" : ""}
                  onClick={() => setTeamFilter("all")}
                  type="button"
                >
                  Todos
                </button>
                {reportTeams.map((team: DailyTeamRow) => (
                  <button
                    aria-pressed={teamFilter === team.id}
                    className={teamFilter === team.id ? "active" : ""}
                    key={team.id}
                    onClick={() => setTeamFilter(team.id)}
                    type="button"
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <section className={hasResponded ? "daily-tu" : "daily-tu is-pending"} aria-live="polite">
            {hasResponded ? (
              <>
                <span className="daily-tu-status answered">✓ Respondido</span>
                <span className="muted small-text">Ya enviaste tu actualización para este día.</span>
                <button className="secondary-button daily-tu-action" onClick={openModal} type="button">
                  Ver mis respuestas
                </button>
              </>
            ) : (
              <>
                <span className="daily-tu-status pending">Sin responder</span>
                <span className="muted small-text">
                   {canRespond ? "Respondé para compartir tu actualización con el equipo." : responseHint}
                </span>
                {canRespond ? (
                  <button className="secondary-button daily-tu-action" onClick={openModal} type="button">
                    Responder Daily
                  </button>
                ) : null}
              </>
            )}
          </section>

          <section className="daily-responses" aria-labelledby="daily-responses-heading">
            <header className="daily-responses-heading">
              <div>
                <p className="eyebrow">Equipo</p>
                <h2 id="daily-responses-heading">Respuestas del equipo</h2>
                <p className="muted">Agrupadas por pregunta para el {longDateLabel}.</p>
              </div>
              <div className="daily-progress" aria-label="Progreso de respuestas">
                <span className="daily-progress-count">{answeredCount} respondieron</span>
                <span className="daily-progress-track" aria-hidden="true">
                  <span className="daily-progress-fill" style={{ width: `${Math.round(progressRatio * 100)}%` }} />
                </span>
              </div>
            </header>

            {emptyState ? (
              <section className="card daily-empty-state daily-empty-prompt">
                <p className="eyebrow">Sin respuestas</p>
                <h3>Todavía no hay respuestas para este día</h3>
                <p className="muted">Sé el primero en compartir tu actualización con el equipo.</p>
                {canRespond ? (
                  <button className="primary-button" onClick={openModal} type="button">
                    Responder Daily
                  </button>
                ) : null}
              </section>
            ) : (
              <DailyResponsesByQuestion
                orderedQuestionTexts={orderedQuestionTexts}
                people={people}
                submissionAnswers={submissionAnswers}
                submissions={submissionsForDate}
              />
            )}
          </section>
        </>
      ) : (
        <DailyConfigPanel data={adminData as DailyAdminData} />
      )}

      <Dialog description={modalDescription} onOpenChange={setModalOpen} open={modalOpen} title={modalTitle}>
        {modalMode === "respond" ? (
          canRespond ? (
            <>
              <DailyResponseForm
                key={`respond-${respondNonce}-${selectedDate}`}
                localDate={selectedDate}
                onSuccess={handleRespondSuccess}
                pendingRuns={responsePendingRuns}
                runQuestions={responseRunQuestions}
              />
              <div className="dialog-form-footer">
                <DialogCloseButton label="Cancelar" />
              </div>
            </>
          ) : (
            <>
              <p className="muted">{responseHint}</p>
              <div className="dialog-form-footer">
                <DialogCloseButton label="Cerrar" />
              </div>
            </>
          )
        ) : (
          <>
            <ReadonlyAnswers answers={readonlyAnswers} />
            <p className="muted small-text daily-readonly-note">
              Las respuestas enviadas no se pueden editar. Se registran como evidencia inmutable.
            </p>
            <div className="dialog-form-footer">
              <DialogCloseButton label="Cerrar" />
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
