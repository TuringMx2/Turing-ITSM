"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  DailySubmissionAnswerRow,
  DailySubmissionReportRunRow,
  DailySubmissionRow,
  DailyTeamRow,
} from "@/app/actions/daily-runs";

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

type DailySubmissionReportProps = {
  teams: DailyTeamRow[];
  submissions: DailySubmissionRow[];
  submissionRuns: DailySubmissionReportRunRow[];
  answers: DailySubmissionAnswerRow[];
  people: Array<{ id: string; full_name: string }>;
};

export function DailySubmissionReport({
  teams,
  submissions,
  submissionRuns,
  answers,
  people,
}: DailySubmissionReportProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTeamFilter = searchParams.get("dailyTeam");
  const teamFilter = requestedTeamFilter && teams.some((team) => team.id === requestedTeamFilter)
    ? requestedTeamFilter
    : "all";
  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const personNameById = useMemo(
    () => new Map(people.map((person) => [person.id, person.full_name])),
    [people],
  );
  const teamIdsBySubmission = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const linkedRun of submissionRuns) {
      const teamIds = result.get(linkedRun.submission_id) ?? new Set<string>();
      teamIds.add(linkedRun.team_id);
      result.set(linkedRun.submission_id, teamIds);
    }
    return result;
  }, [submissionRuns]);
  const answersBySubmission = useMemo(() => {
    const result = new Map<string, DailySubmissionAnswerRow[]>();
    for (const answer of answers) {
      const submissionAnswers = result.get(answer.submission_id) ?? [];
      submissionAnswers.push(answer);
      result.set(answer.submission_id, submissionAnswers);
    }
    return result;
  }, [answers]);
  const filteredSubmissions = submissions.filter((submission) => {
    return teamFilter === "all" || teamIdsBySubmission.get(submission.id)?.has(teamFilter);
  });

  function updateTeamFilter(value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("dailyTeam");
    } else {
      params.set("dailyTeam", value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section className="daily-report" aria-labelledby="daily-report-heading">
      <header className="daily-report-heading">
        <div>
          <p className="eyebrow">Reporte del equipo</p>
          <h2 id="daily-report-heading">Respuestas enviadas</h2>
          <p className="muted">Incluye los envíos registrados en los últimos 7 días. La ventana se determina por la hora de envío.</p>
        </div>
        <span aria-live="polite" className="daily-report-count">{filteredSubmissions.length} envíos</span>
      </header>

      <div className="daily-filter-bar">
        <label htmlFor="daily-report-team-filter">
          <span>Filtrar por equipo</span>
          <select
            id="daily-report-team-filter"
            onChange={(event) => updateTeamFilter(event.target.value)}
            value={teamFilter}
          >
            <option value="all">Todos los equipos</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
      </div>

      {filteredSubmissions.length === 0 ? (
        <section className="card daily-empty-state">
          <p className="eyebrow">Sin respuestas</p>
          <h3>No hay envíos{teamFilter !== "all" ? " para este equipo" : " en los últimos 7 días"}</h3>
          <p className="muted">Las respuestas enviadas aparecerán acá cuando estén disponibles para tu equipo.</p>
          {teamFilter !== "all" ? (
            <button className="secondary-button" onClick={() => updateTeamFilter("all")} type="button">Ver todos los equipos</button>
          ) : null}
        </section>
      ) : (
        <div className="daily-report-list">
          {filteredSubmissions.map((submission) => {
            const submissionTeams = Array.from(teamIdsBySubmission.get(submission.id) ?? [])
              .map((teamId) => ({ id: teamId, name: teamNameById.get(teamId) }))
              .filter((team): team is { id: string; name: string } => Boolean(team.name));
            const submissionAnswers = answersBySubmission.get(submission.id) ?? [];

            return (
              <details className="daily-report-card" key={submission.id}>
                <summary className="daily-report-card-header">
                  <div>
                    <h3>{personNameById.get(submission.user_id) ?? "Miembro de soporte"}</h3>
                    <time dateTime={submission.submitted_at}>{formatDateTime(submission.submitted_at)}</time>
                  </div>
                  <div aria-label="Equipos relacionados" className="daily-team-tags">
                    {submissionTeams.map((team) => <span key={team.id}>{team.name}</span>)}
                  </div>
                  <span className="daily-report-expand">{submissionAnswers.length} respuestas</span>
                </summary>
                <dl className="daily-answer-list">
                  {submissionAnswers.map((answer, index) => (
                    <div className="daily-answer-item" key={`${answer.submission_id}-${index}`}>
                      <dt>{answer.question_text}</dt>
                      <dd>{answer.answer_text}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
