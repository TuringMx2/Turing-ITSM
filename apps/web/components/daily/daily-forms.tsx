"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createDailyQuestion,
  deactivateDailyQuestion,
  generateDailyRun,
  saveTeamDailyQuestions,
  saveTeamDailySchedule,
  submitDailyResponse,
  type DailyCompletionTeam,
  type DailyActionState,
  type DailyQuestionRow,
  type DailyResponsePrefill,
  type DailyRunQuestionRow,
  type DailyRunRow,
  type DailyScheduleRow,
  type DailyTeamRow,
} from "@/app/actions/daily-runs";
import {
  submitDailyTaskCompletion,
  type DailyTaskActionState,
} from "@/app/actions/daily-tasks";
import { isDailyCompletedWorkQuestion, isDailyPlannedWorkQuestion } from "@/lib/daily";

const initialState: DailyActionState = { status: "idle", message: "" };
const initialTaskCompletionState: DailyTaskActionState = { status: "idle", message: "" };
const maxPlannedTasks = 100;

type DailyAction = (
  state: DailyActionState,
  formData: FormData,
) => Promise<DailyActionState>;

const weekdays = [
  { value: 1, label: "L", name: "Lunes" },
  { value: 2, label: "M", name: "Martes" },
  { value: 3, label: "X", name: "Miércoles" },
  { value: 4, label: "J", name: "Jueves" },
  { value: 5, label: "V", name: "Viernes" },
  { value: 6, label: "S", name: "Sábado" },
  { value: 7, label: "D", name: "Domingo" },
];

function MutationForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className = "daily-form",
  footer,
  onSuccess,
  onSubmit,
}: {
  action: DailyAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  className?: string;
  footer?: ReactNode;
  onSuccess?: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const handledSuccess = useRef<DailyActionState | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const router = useRouter();

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state) return;
    handledSuccess.current = state;
    onSuccessRef.current?.();
    router.refresh();
  }, [router, state]);

  return (
    <form action={formAction} className={className} onSubmit={onSubmit}>
      {children}
      {state.message ? (
        <p
          aria-live="polite"
          className={state.status === "error" ? "action-message error" : "action-message success"}
          ref={state.status === "error" ? errorRef : undefined}
          role={state.status === "error" ? "alert" : "status"}
          tabIndex={state.status === "error" ? -1 : undefined}
        >
          {state.message}
        </p>
      ) : null}
      {footer ? (
        <div className="dialog-form-footer">
          {footer}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? pendingLabel : submitLabel}
          </button>
        </div>
      ) : (
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? pendingLabel : submitLabel}
        </button>
      )}
    </form>
  );
}

export function CreateDailyQuestionForm() {
  return (
    <MutationForm action={createDailyQuestion} pendingLabel="Creando…" submitLabel="Agregar pregunta">
      <label>
        <span>Nueva pregunta</span>
        <textarea
          autoComplete="off"
          maxLength={500}
          minLength={3}
          name="questionText"
          placeholder="Ej.: ¿Qué avance querés compartir con el equipo?…"
          required
          rows={3}
        />
      </label>
    </MutationForm>
  );
}

export function DeactivateDailyQuestionForm({ questionId }: { questionId: string }) {
  return (
    <details className="daily-question-actions">
      <summary>Más acciones</summary>
      <MutationForm
        action={deactivateDailyQuestion}
        className="daily-deactivate-form"
        pendingLabel="Desactivando…"
        submitLabel="Desactivar"
      >
        <input name="questionId" type="hidden" value={questionId} />
        <label className="daily-confirmation">
          <input name="confirmation" required type="checkbox" value="true" />
          <span>Quitar esta pregunta de las selecciones activas.</span>
        </label>
      </MutationForm>
    </details>
  );
}

function intervalToMinutes(value: string): number {
  const match = /^(?:(\d+) days? )?(\d{2}):(\d{2}):\d{2}$/.exec(value);
  if (!match) return 480;
  return Number(match[1] ?? "0") * 1440 + Number(match[2]) * 60 + Number(match[3]);
}

function timeInputValue(value: string): string {
  return /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "09:00";
}

export function TeamDailyConfigurationForm({
  team,
  schedule,
  selectedQuestionIds,
  activeQuestions,
}: {
  team: DailyTeamRow;
  schedule?: DailyScheduleRow;
  selectedQuestionIds: string[];
  activeQuestions: DailyQuestionRow[];
}) {
  const timezoneListId = `${useId()}-daily-timezones`;
  const positionValues = [0, 1, 2].map((index) => selectedQuestionIds[index] ?? "");
  const selectedWeekdays = new Set(schedule?.scheduled_weekdays ?? [1, 2, 3, 4, 5]);

  return (
    <details className="card daily-team-card">
      <summary className="daily-team-heading">
        <div>
          <p className="eyebrow">Equipo</p>
          <h3>{team.name}</h3>
          <p className="muted small-text">{schedule ? `${timeInputValue(schedule.local_time)} · ${schedule.scheduled_weekdays.length} días` : "Configuración pendiente"}</p>
        </div>
        <span className={schedule?.is_active ? "daily-state active" : "daily-state"}>
          {schedule?.is_active ? "Horario activo" : "Sin horario activo"}
        </span>
      </summary>

      <div className="daily-team-editor">

      <MutationForm action={saveTeamDailySchedule} pendingLabel="Guardando…" submitLabel="Guardar horario">
        <input name="teamId" type="hidden" value={team.id} />
        <div className="daily-schedule-grid">
          <label>
            <span>Zona horaria</span>
            <input
              autoComplete="off"
              defaultValue={schedule?.timezone_name ?? "America/Argentina/Buenos_Aires"}
              list={timezoneListId}
              maxLength={100}
              name="timezoneName"
              required
            />
          </label>
          <label>
            <span>Hora local</span>
            <input autoComplete="off" defaultValue={timeInputValue(schedule?.local_time ?? "09:00")} name="localTime" required type="time" />
          </label>
          <label>
            <span>Ventana de respuesta (minutos)</span>
            <input
              autoComplete="off"
              defaultValue={intervalToMinutes(schedule?.response_window ?? "08:00:00")}
              max={10080}
              min={1}
              name="responseWindowMinutes"
              required
              step={1}
              type="number"
            />
          </label>
        </div>
        <datalist id={timezoneListId}>
          <option value="America/Argentina/Buenos_Aires" />
          <option value="America/Santiago" />
          <option value="America/Bogota" />
          <option value="America/Mexico_City" />
          <option value="America/New_York" />
          <option value="Europe/Madrid" />
          <option value="UTC" />
        </datalist>
        <fieldset className="daily-weekdays">
          <legend>Días de ejecución</legend>
          <div>
            {weekdays.map((weekday) => (
              <label key={weekday.value}>
                <input aria-label={weekday.name} defaultChecked={selectedWeekdays.has(weekday.value)} name="weekday" type="checkbox" value={weekday.value} />
                <span>{weekday.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="daily-confirmation">
          <input defaultChecked={schedule?.is_active ?? true} name="isActive" type="checkbox" value="true" />
          <span>Equipo habilitado para recibir ejecuciones Daily</span>
        </label>
      </MutationForm>

      <MutationForm action={saveTeamDailyQuestions} pendingLabel="Guardando…" submitLabel="Guardar preguntas">
        <input name="teamId" type="hidden" value={team.id} />
        <div className="daily-question-selection-heading">
          <div>
            <h3>Preguntas y orden</h3>
            <p className="muted small-text">La posición 1 aparece primero. Podés operar con menos de 3 preguntas, pero es recomendable completar las 3.</p>
          </div>
          {selectedQuestionIds.length < 3 ? <span className="daily-state warning">Faltan {3 - selectedQuestionIds.length}</span> : null}
        </div>
        {[1, 2, 3].map((position, index) => (
          <label className="daily-question-position" key={position}>
            <span>Posición {position}</span>
            <select autoComplete="off" defaultValue={positionValues[index]} name="questionId">
              <option value="">Sin pregunta</option>
              {activeQuestions.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.question_text}
                </option>
              ))}
            </select>
          </label>
        ))}
        <details className="context-note">
          <summary>Consideración técnica</summary>
          <p>Si una pregunta se desactiva mientras editás, actualizá la página antes de guardar nuevamente.</p>
        </details>
      </MutationForm>
      </div>
    </details>
  );
}

export function GenerateDailyRunForm({ teams, schedules }: { teams: DailyTeamRow[]; schedules: DailyScheduleRow[] }) {
  const activeTeamIds = new Set(schedules.filter((schedule) => schedule.is_active).map((schedule) => schedule.team_id));
  const eligibleTeams = teams.filter((team) => activeTeamIds.has(team.id));

  if (eligibleTeams.length === 0) {
    return <p className="muted">Primero guardá un horario activo para al menos un equipo.</p>;
  }

  return (
    <MutationForm action={generateDailyRun} pendingLabel="Generando…" submitLabel="Generar ejecución">
      <div className="daily-schedule-grid">
        <label>
          <span>Equipo con horario activo</span>
          <select autoComplete="off" defaultValue="" name="teamId" required>
            <option disabled value="">Seleccioná un equipo…</option>
            {eligibleTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Fecha local del equipo</span>
          <input autoComplete="off" name="localDate" required type="date" />
        </label>
      </div>
      <p className="muted small-text">La ejecución usa la fecha local y el horario configurado del equipo.</p>
    </MutationForm>
  );
}

export function DailyResponseForm({
  localDate,
  pendingRuns,
  runQuestions,
  prefill,
  onSuccess,
  className = "card daily-response-form",
  footer,
}: {
  localDate: string;
  pendingRuns: DailyRunRow[];
  runQuestions: DailyRunQuestionRow[];
  prefill?: DailyResponsePrefill;
  onSuccess?: () => void;
  className?: string;
  footer?: ReactNode;
}) {
  type PlannedTask = { id: string; value: string; carriedTaskId?: string };

  const pendingRunIds = new Set(pendingRuns.map((run) => run.id));
  const runQuestionsForPendingRuns = runQuestions.filter((question) => pendingRunIds.has(question.run_id));
  const questions = Array.from(
    runQuestionsForPendingRuns
      .slice()
      .sort((left, right) => left.position - right.position)
      .reduce((byId, question) => {
        if (!byId.has(question.question_id)) byId.set(question.question_id, question);
        return byId;
      }, new Map<string, DailyRunQuestionRow>())
      .values(),
  );
  const plannedWorkQuestion = questions.find((question) => isDailyPlannedWorkQuestion(question.semantic_key));
  const taskIdPrefix = useId();
  const taskErrorId = `${taskIdPrefix}-error`;
  const nextTaskIndex = useRef(2);
  const nextTaskInputId = useRef<string | null>(null);
  const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>(() => {
    const carriedTasks = prefill?.carriedTasks ?? [];
    return carriedTasks.length > 0
      ? carriedTasks.map((task, index) => ({
          id: `${taskIdPrefix}-carried-${index + 1}`,
          value: task.title,
          carriedTaskId: task.id,
        }))
      : [{ id: `${taskIdPrefix}-task-1`, value: "" }];
  });
  const [plannedWorkError, setPlannedWorkError] = useState("");
  const plannedTaskCount = plannedTasks.filter((task) => task.value.trim()).length;
  const plannedWorkAnswer = plannedTasks
    .map((task) => task.value.trim())
    .filter(Boolean)
    .join("\n");

  function addPlannedTask() {
    if (plannedTaskCount >= maxPlannedTasks) {
      setPlannedWorkError("No podés agregar más de 100 tareas con contenido.");
      return;
    }
    const id = `${taskIdPrefix}-task-${nextTaskIndex.current}`;
    nextTaskIndex.current += 1;
    nextTaskInputId.current = id;
    setPlannedTasks((tasks) => [...tasks, { id, value: "" }]);
  }

  function updatePlannedTask(id: string, value: string) {
    const task = plannedTasks.find((plannedTask) => plannedTask.id === id);
    const addsNonEmptyTask = !task?.value.trim() && value.trim();
    if (addsNonEmptyTask && plannedTaskCount >= maxPlannedTasks) {
      setPlannedWorkError("No podés agregar más de 100 tareas con contenido.");
      return;
    }
    setPlannedTasks((tasks) => tasks.map((task) => task.id === id ? { ...task, value } : task));
    if (plannedWorkError) setPlannedWorkError("");
  }

  function removePlannedTask(id: string) {
    setPlannedTasks((tasks) => tasks.length === 1 ? tasks : tasks.filter((task) => task.id !== id));
    if (plannedWorkError) setPlannedWorkError("");
  }

  function handleTaskKeyDown(event: KeyboardEvent<HTMLInputElement>, task: PlannedTask) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (task.value.trim()) addPlannedTask();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!plannedWorkQuestion) return;
    if (!plannedWorkAnswer) {
      event.preventDefault();
      setPlannedWorkError("Agregá al menos una tarea para tu plan de hoy.");
      return;
    }
    if (plannedTasks.some((task) => task.carriedTaskId && !task.value.trim())) {
      event.preventDefault();
      setPlannedWorkError("Las actividades trasladadas deben conservar un texto antes de enviar.");
      return;
    }
    if (plannedWorkAnswer.length > 4000) {
      event.preventDefault();
      setPlannedWorkError("El plan de hoy no puede superar los 4000 caracteres.");
      return;
    }
    setPlannedWorkError("");
  }

  if (pendingRuns.length === 0) {
    return <p className="muted">La ejecución seleccionada ya no está disponible para esta fecha.</p>;
  }

  return (
    <MutationForm
      action={submitDailyResponse}
      onSubmit={handleSubmit}
      onSuccess={onSuccess}
      pendingLabel="Enviando…"
      submitLabel="Enviar"
      className={className}
      footer={footer}
    >
      <div className="daily-response-card">
        <input name="localDate" type="hidden" value={localDate} />
        {pendingRuns.map((run) => <input key={run.id} name="runId" type="hidden" value={run.id} />)}
        <div className="daily-response-intro">
          <p className="eyebrow">Respuesta única</p>
          <h2>Respondé las preguntas de tus ejecuciones pendientes</h2>
          <p className="muted">Las preguntas compartidas se responden una sola vez y se aplican a las {pendingRuns.length} ejecuciones visibles.</p>
        </div>
        {questions.map((question, index) => {
          const isPlannedWork = isDailyPlannedWorkQuestion(question.semantic_key);
          const isCompletedWork = isDailyCompletedWorkQuestion(question.semantic_key);
          const questionLabel = `${index + 1}. ${question.question_text}`;

          return isPlannedWork ? (
            <div className="daily-answer-field daily-planned-work-field" key={question.question_id}>
                <span>{questionLabel}</span>
                <input name={`answer:${question.question_id}`} type="hidden" value={plannedWorkAnswer} />
              <div aria-describedby={plannedWorkError ? taskErrorId : undefined} aria-label="Tareas planificadas" className="daily-planned-work-list" role="group">
                {plannedTasks.map((task, taskIndex) => (
                  <div className="daily-planned-work-row" key={task.id}>
                    {task.carriedTaskId ? <input name="carriedTaskId" type="hidden" value={task.carriedTaskId} /> : null}
                    <input
                      aria-describedby={plannedWorkError ? taskErrorId : undefined}
                      aria-label={`Tarea ${taskIndex + 1}`}
                      autoComplete="off"
                      autoFocus={taskIndex === 0}
                      maxLength={400}
                      onChange={(event) => updatePlannedTask(task.id, event.target.value)}
                      onKeyDown={(event) => handleTaskKeyDown(event, task)}
                      placeholder="Escribí tu respuesta…"
                      ref={(element) => {
                        if (element && nextTaskInputId.current === task.id) {
                          element.focus();
                          nextTaskInputId.current = null;
                        }
                      }}
                      type="text"
                      value={task.value}
                    />
                    {taskIndex > 0 && !task.carriedTaskId ? (
                      <button
                        aria-label={`Eliminar tarea ${taskIndex + 1}`}
                        className="daily-planned-work-remove"
                        onClick={() => removePlannedTask(task.id)}
                        title="Eliminar tarea"
                        type="button"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                aria-describedby={plannedWorkError ? taskErrorId : undefined}
                className="daily-planned-work-add"
                onClick={addPlannedTask}
                type="button"
              >
                + Agregar otra tarea
              </button>
              {plannedWorkError ? <p className="action-message error" id={taskErrorId} role="alert">{plannedWorkError}</p> : null}
            </div>
          ) : (
            <label className="daily-answer-field" key={question.question_id}>
              <span>{questionLabel}</span>
              <textarea
                autoComplete="off"
                defaultValue={isCompletedWork ? prefill?.completedWork : undefined}
                maxLength={4000}
                minLength={1}
                name={`answer:${question.question_id}`}
                placeholder="Escribí tu respuesta…"
                required
                rows={4}
              />
            </label>
          );
        })}
        <p className="daily-response-note muted small-text">
          <span aria-hidden="true" className="daily-response-note-icon">i</span>
          <span>Al enviar, la respuesta queda registrada como evidencia inmutable y no se puede editar.</span>
        </p>
      </div>
    </MutationForm>
  );
}

function DailyTaskCompletionForm({ team }: { team: DailyCompletionTeam }) {
  const [state, formAction, pending] = useActionState(submitDailyTaskCompletion, initialTaskCompletionState);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const handledSuccess = useRef<DailyTaskActionState | null>(null);
  const router = useRouter();
  const uncheckedCount = team.tasks.length - completedIds.size;
  const isSubmitted = team.completionSubmitted || state.status === "success";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
    if (state.status === "success" && handledSuccess.current !== state) {
      handledSuccess.current = state;
      router.refresh();
    }
  }, [router, state]);

  if (isSubmitted) {
    return (
      <p className="action-message success" role="status">
        {state.status === "success" ? "Cierre Daily registrado. Tu evidencia queda inmutable." : "Ya registraste el cierre Daily de este equipo para hoy."}
      </p>
    );
  }

  return (
    <form action={formAction} className="daily-form daily-completion-form">
      <input name="teamId" type="hidden" value={team.id} />
      <input name="logicalDate" type="hidden" value={team.localDate} />
      <ol className="daily-checklist">
        {team.tasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                checked={completedIds.has(task.id)}
                name="completedTaskId"
                onChange={(event) => {
                  setCompletedIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(task.id);
                    else next.delete(task.id);
                    return next;
                  });
                }}
                type="checkbox"
                value={task.id}
              />
              <span>{task.title}</span>
            </label>
          </li>
        ))}
      </ol>
      {state.message ? (
        <p
          aria-live="polite"
          className={state.status === "error" ? "action-message error" : "action-message success"}
          ref={state.status === "error" ? errorRef : undefined}
          role={state.status === "error" ? "alert" : "status"}
          tabIndex={state.status === "error" ? -1 : undefined}
        >
          {state.message}
        </p>
      ) : null}
      {uncheckedCount > 0 ? (
        <div className="daily-completion-choices" aria-label="Resolución de tareas pendientes">
          <p className="muted small-text">Quedan {uncheckedCount} tareas pendientes. Elegí una opción:</p>
          <div>
            <button className="secondary-button danger-button" disabled={pending} name="resolution" type="submit" value="delete">
              Eliminar las restantes
            </button>
              <button className="primary-button" disabled={pending} name="resolution" type="submit" value="carry">
                Pasarlas al próximo Daily
            </button>
          </div>
        </div>
      ) : (
        <button className="primary-button" disabled={pending} name="resolution" type="submit" value="none">
          {pending ? "Registrando…" : "Registrar cierre"}
        </button>
      )}
    </form>
  );
}

export function DailyCompletionSection({ teams }: { teams: DailyCompletionTeam[] }) {
  const completionTeams = teams;
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const selectedTeam = completionTeams.length === 1
    ? completionTeams[0]
    : completionTeams.find((team) => team.id === selectedTeamId);

  if (completionTeams.length === 0) return null;

  return (
    <section className="daily-completion-section" aria-labelledby="daily-completion-heading">
      <header className="daily-completion-heading">
        <div>
          <p className="eyebrow">Cierre de hoy</p>
          <h2 id="daily-completion-heading">¿Qué actividades lograste acabar hoy?</h2>
          <p className="muted small-text">Marcá las actividades terminadas. Las restantes se eliminan o pasan al próximo Daily según tu elección.</p>
        </div>
        <span className="daily-state warning">Después de las 16:00</span>
      </header>
      {completionTeams.length > 1 ? (
        <label className="daily-completion-team-picker">
          <span>Equipo para cerrar</span>
          <select onChange={(event) => setSelectedTeamId(event.target.value)} value={selectedTeamId}>
            <option value="">Seleccioná un equipo…</option>
            {completionTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
      ) : null}
      {selectedTeam ? (
        <div className="daily-completion-team">
          {completionTeams.length === 1 ? <p className="eyebrow">{selectedTeam.name}</p> : null}
          <DailyTaskCompletionForm key={`${selectedTeam.id}:${selectedTeam.localDate}`} team={selectedTeam} />
        </div>
      ) : (
        <p className="muted small-text">Elegí un equipo para ver sus tareas planificadas.</p>
      )}
    </section>
  );
}
