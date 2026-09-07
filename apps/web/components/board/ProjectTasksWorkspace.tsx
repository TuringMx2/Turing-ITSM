"use client";

import { useState } from "react";
import type { BoardColumn, BoardTask, ProjectMemberOption } from "@/app/actions/tasks";
import { Board, BoardCreateTaskButton } from "./Board";
import { TaskList } from "./TaskList";

type TaskView = "list" | "current-sprint";

export function ProjectTasksWorkspace({
  projectId,
  columns,
  currentSprintTasks,
  allTasks,
  members,
  readOnly,
}: {
  projectId: string;
  columns: BoardColumn[];
  currentSprintTasks: BoardTask[];
  allTasks: BoardTask[];
  members: ProjectMemberOption[];
  readOnly: boolean;
}) {
  const [activeView, setActiveView] = useState<TaskView>("list");

  function moveBetweenTabs(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextView: TaskView =
      event.key === "ArrowLeft" || event.key === "Home" ? "list" : "current-sprint";
    setActiveView(nextView);
    document.getElementById(`project-task-tab-${nextView}`)?.focus();
  }

  return (
    <section className="project-tasks-workspace" aria-labelledby="project-tasks-title">
      <header className="section-heading board-page-toolbar project-tasks-toolbar">
        <div>
          <h2 id="project-tasks-title">Tareas</h2>
          <p className="muted small-text project-tasks-summary">
            {currentSprintTasks.length} en Sprint actual · {allTasks.length} en total
          </p>
        </div>
        {readOnly ? (
          <span className="muted small-text board-page-status">Proyecto archivado · solo lectura</span>
        ) : (
          <BoardCreateTaskButton
            projectId={projectId}
            columns={columns}
            members={members}
            readOnly={readOnly}
          />
        )}
      </header>

      <div className="project-task-tabs" role="tablist" aria-label="Vistas de tareas">
        <button
          id="project-task-tab-list"
          type="button"
          role="tab"
          aria-selected={activeView === "list"}
          aria-controls="project-task-panel-list"
          tabIndex={activeView === "list" ? 0 : -1}
          className={`project-task-tab${activeView === "list" ? " is-active" : ""}`}
          onClick={() => setActiveView("list")}
          onKeyDown={moveBetweenTabs}
        >
          Lista
        </button>
        <button
          id="project-task-tab-current-sprint"
          type="button"
          role="tab"
          aria-selected={activeView === "current-sprint"}
          aria-controls="project-task-panel-current-sprint"
          tabIndex={activeView === "current-sprint" ? 0 : -1}
          className={`project-task-tab${activeView === "current-sprint" ? " is-active" : ""}`}
          onClick={() => setActiveView("current-sprint")}
          onKeyDown={moveBetweenTabs}
        >
          Sprint actual
        </button>
      </div>

      <div
        id="project-task-panel-list"
        role="tabpanel"
        aria-labelledby="project-task-tab-list"
        hidden={activeView !== "list"}
      >
        <TaskList
          initialTasks={allTasks}
          columns={columns}
          members={members}
          readOnly={readOnly}
        />
      </div>
      <div
        id="project-task-panel-current-sprint"
        role="tabpanel"
        aria-labelledby="project-task-tab-current-sprint"
        hidden={activeView !== "current-sprint"}
      >
        <Board
          projectId={projectId}
          initialColumns={columns}
          initialTasks={currentSprintTasks}
          members={members}
          readOnly={readOnly}
        />
      </div>
    </section>
  );
}
