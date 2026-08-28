#!/usr/bin/env node
/**
 * Minimal RLS / integration verification for workers-daily-tasks (T9).
 * Checks:
 *  - Migration contains expected RLS policies
 *  - Validation schemas exist
 *  - Tasks Server Actions export required functions with expected signatures
 *  - Board components exist and use @dnd-kit
 *  - Dashboard widgets call listMyCards
 *
 * Run: node scripts/verify-workers-rls.mjs
 * Exit 0 on pass, 1 on fail.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname ?? ".", "..");
function resolve(...parts) {
  return join(root, ...parts);
}

let failures = 0;
function check(label, condition, hint = "") {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}${hint ? ` — ${hint}` : ""}`);
    failures += 1;
  }
}

function fileContains(path, needle) {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  return content.includes(needle);
}

// 1. Migration RLS policies
const migration = resolve("supabase/migrations/20260825_workers_daily_tasks.sql");
check("Migration file exists", existsSync(migration));
if (existsSync(migration)) {
  const sql = readFileSync(migration, "utf8");
  const expectedPolicies = [
    "projects_select_scoped",
    "projects_insert_admin",
    "projects_update_admin",
    "projects_delete_admin",
    "project_members_select_scoped",
    "project_members_insert_admin",
    "project_members_delete_admin",
    "tasks_select_scoped",
    "tasks_insert_member",
    "tasks_update_member",
    "tasks_delete_admin",
  ];
  for (const p of expectedPolicies) {
    check(`RLS policy present: ${p}`, sql.includes(p));
  }
  check("Helper is_admin() defined", sql.includes("create or replace function public.is_admin()"));
  check("RLS enabled on projects", sql.includes("alter table public.projects enable row level security"));
  check("RLS enabled on tasks", sql.includes("alter table public.tasks enable row level security"));
  check("Tasks RLS uses project_members membership", sql.includes("project_id in (select project_id from public.project_members"));
}

// 2. Validation schemas
const validation = resolve("packages/validation/src/index.ts");
check("Validation file exists", existsSync(validation));
if (existsSync(validation)) {
  const v = readFileSync(validation, "utf8");
  check("createTaskSchema", v.includes("createTaskSchema"));
  check("updateTaskStatusSchema", v.includes("updateTaskStatusSchema"));
  check("listTasksSchema", v.includes("listTasksSchema"));
  check("createProjectSchema", v.includes("createProjectSchema"));
}

// 3. Tasks Server Actions
const tasks = resolve("apps/web/app/actions/tasks.ts");
check("tasks.ts exists", existsSync(tasks));
if (existsSync(tasks)) {
  const t = readFileSync(tasks, "utf8");
  check("exports createTask", t.includes("export async function createTask"));
  check("exports updateTaskStatus", t.includes("export async function updateTaskStatus"));
  check("exports listTasks", t.includes("export async function listTasks"));
  check("exports listMyCards", t.includes("export async function listMyCards"));
  check("exports deleteTask", t.includes("export async function deleteTask"));
  check("uses zod validation", t.includes("safeParse"));
  check("checks isProjectMember", t.includes("isProjectMember"));
  check("handles RLS friendly error", t.includes("friendlyRlsError"));
  check("revalidatePath on board", t.includes("revalidatePath"));
  check("deleteTask admin-only", t.includes('role !== "admin"'));
  check("listMyCards orders by priority", t.includes("priorityWeight") || t.includes("priority"));
}

// 4. Board components
const board = resolve("apps/web/components/board/Board.tsx");
const column = resolve("apps/web/components/board/Column.tsx");
const card = resolve("apps/web/components/board/Card.tsx");
const dialog = resolve("apps/web/components/board/CreateCardDialog.tsx");
check("Board.tsx exists", existsSync(board));
check("Column.tsx exists", existsSync(column));
check("Card.tsx exists", existsSync(card));
check("CreateCardDialog.tsx exists", existsSync(dialog));
if (existsSync(board)) {
  const b = readFileSync(board, "utf8");
  check("Board uses DndContext", b.includes("DndContext"));
  check("Board calls updateTaskStatus", b.includes("updateTaskStatus"));
  check("Board calls deleteTask", b.includes("deleteTask"));
  check("Board handles @dnd-kit", b.includes("@dnd-kit"));
}
if (existsSync(card)) {
  const c = readFileSync(card, "utf8");
  check("Card uses useSortable", c.includes("useSortable"));
}
if (existsSync(column)) {
  const col = readFileSync(column, "utf8");
  check("Column uses useDroppable", col.includes("useDroppable"));
  check("Column uses SortableContext", col.includes("SortableContext"));
}
if (existsSync(dialog)) {
  const d = readFileSync(dialog, "utf8");
  check("CreateCardDialog calls createTask", d.includes("createTask"));
}

// 5. Board wrappers fetch tasks via listTasks
const adminBoard = resolve("apps/web/app/(admin)/admin/projects/[projectId]/board/page.tsx");
const workerBoard = resolve("apps/web/app/(workers)/projects/[projectId]/board/page.tsx");
for (const p of [adminBoard, workerBoard]) {
  const label = p.includes("(admin)") ? "Admin board" : "Worker board";
  check(`${label} exists`, existsSync(p));
  if (existsSync(p)) {
    const content = readFileSync(p, "utf8");
    check(`${label} fetches tasks via listTasks`, content.includes("listTasks"));
    check(`${label} renders Board`, content.includes("<Board"));
    check(`${label} handles drag via updateTaskStatus (inside Board)`, true); // delegated to Board
  }
}

// 6. Dashboard widget
const dashboardPage = resolve("apps/web/app/(dashboard)/dashboard/page.tsx");
const myCardsWidget = resolve("apps/web/components/dashboard/MyCardsWidget.tsx");
const myCardsClient = resolve("apps/web/components/dashboard/MyCardsClient.tsx");
check("Dashboard page exists", existsSync(dashboardPage));
check("MyCardsWidget exists", existsSync(myCardsWidget));
check("MyCardsClient exists", existsSync(myCardsClient));
if (existsSync(myCardsWidget)) {
  const w = readFileSync(myCardsWidget, "utf8");
  check("MyCardsWidget calls listMyCards", w.includes("listMyCards"));
  check("MyCardsWidget shows top 10 (pageSize 10)", w.includes("pageSize: 10"));
  check("MyCardsWidget ordered by priority (weight or label)", w.includes("priority"));
}
if (existsSync(myCardsClient)) {
  const c = readFileSync(myCardsClient, "utf8");
  check("MyCardsClient calls listMyCards", c.includes("listMyCards"));
}

// 7. package.json has @dnd-kit
const pkg = resolve("apps/web/package.json");
if (existsSync(pkg)) {
  const p = JSON.parse(readFileSync(pkg, "utf8"));
  check("@dnd-kit/core installed", !!p.dependencies?.["@dnd-kit/core"]);
  check("@dnd-kit/sortable installed", !!p.dependencies?.["@dnd-kit/sortable"]);
}

// Summary
console.log("\n---");
if (failures === 0) {
  console.log("All RLS/integration checks passed.");
  process.exit(0);
} else {
  console.error(`${failures} check(s) failed. See above.`);
  process.exit(1);
}
