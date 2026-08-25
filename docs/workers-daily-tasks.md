# Workers Daily Tasks — Implementation Notes (T1–T9)

Single-PR change `workers-daily-tasks` (exception size). Stack: Next.js + Supabase, `apps/api` untouched per instructions.

## Scope

- Projects (admin creates, membership via `project_members`)
- Daily check-ins (Q1 yesterday / Q2 today / Q3 blockers, one per user per UTC day, edit until 23:59 UTC)
- Tasks / Kanban board (todo → doing → done → blocked, priority low/medium/high/urgent, assignee)
- Dashboard "My cards" widget (assignee=self, top 10 by priority)

## Files

| Task | Files |
|------|-------|
| T1 | `supabase/migrations/20260825_workers_daily_tasks.sql`, `packages/types/src/index.ts`, `packages/validation/src/index.ts` |
| T2–T3 | `apps/web/lib/rbac.ts`, `apps/web/lib/auth.ts` (isProjectMember, requireAuth/requireAdmin), `apps/web/middleware.ts`, `apps/web/app/actions/daily.ts` |
| T4 | `apps/web/app/(workers)/daily/page.tsx`, `apps/web/app/(workers)/daily/DailyCheckinForm.tsx`, `apps/web/app/(admin)/admin/daily/page.tsx` |
| T5 | `apps/web/app/actions/projects.ts` |
| T6 | `apps/web/app/(admin)/admin/projects/{page,CreateProjectForm,AddMemberForm,[projectId]/board}`, `apps/web/app/(workers)/projects/{page,[projectId]/board}` (wrappers) |
| T7 | `apps/web/app/actions/tasks.ts` |
| T8 | `apps/web/components/board/{Board,Column,Card,CreateCardDialog}`, `apps/web/app/(dashboard)/dashboard/page.tsx`, `apps/web/components/dashboard/{MyCardsWidget,MyCardsClient}`, `apps/web/components/module-placeholder.tsx` |
| T9 | `scripts/verify-workers-rls.mjs`, this doc |

## Server Actions

### `apps/web/app/actions/tasks.ts`

- `createTask(input)` — zod `createTaskSchema`, require auth, check `isProjectMember` unless admin, insert `tasks`, friendly RLS error mapping (42501 / row-level security → "Forbidden: not a project member…"), `revalidatePath` for both board routes + dashboard.
- `updateTaskStatus({taskId,status})` — zod `updateTaskStatusSchema`, fetch task's `project_id`, membership check, update status, revalidate.
- `listTasks({projectId,status,priority,assigneeId,page,pageSize})` — zod `listTasksSchema`, scoped: if `projectId` given check membership; else non-admin limited to projects where member; admin sees all. Handles Supabase `count`, `range`.
- `listMyCards({page,pageSize})` — assignee=self, fetches up to 50 then JS sorts by `priorityWeight` (urgent 4 → high 3 → medium 2 → low 1) + `created_at` desc, slices page, plus `count` head query. Used by dashboard widgets.
- `deleteTask({taskId})` — `deleteTaskSchema`, admin-only (`role !== "admin"` → Forbidden), fetch `project_id` for revalidation, `delete`, revalidate.

All actions use `createClient()` (ssr), `resolveRole()` via `profiles.role`, and `friendlyRlsError()`.

### RLS

Migration enables RLS on `projects`, `project_members`, `daily_checkins`, `tasks` and defines 15 policies:

- `projects_select_scoped` (admin or member), `projects_{insert,update,delete}_admin`
- `project_members_select_scoped` (admin or own), `_insert_admin`, `_delete_admin`
- `daily_checkins_insert_own`, `_select_own_or_admin`, `_update_own_today` (date = UTC today), `_delete_admin`
- `tasks_select_scoped` / `_insert_member` / `_update_member` (admin or `project_id in (select … where user_id = auth.uid())`), `tasks_delete_admin`

Helper `public.is_admin()` (security definer, `profiles.role = 'admin'`).

## Kanban Board

- Dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (added via `npm install` in `apps/web`).
- `Board.tsx` — `DndContext` + `closestCenter` + `PointerSensor(distance 6)`, groups tasks by status, `DragOverlay`, optimistic status update then `updateTaskStatus`, revert on error, `revalidate`. Passes `isAdmin` to show delete.
- `Column.tsx` — `useDroppable` (id = status), `SortableContext` per column, "+ Add" opens dialog.
- `Card.tsx` — `useSortable`, priority badge (gray/blue/orange/red), assignee snippet, delete button if admin.
- `CreateCardDialog.tsx` — modal form calling `createTask` with `projectId`, `status` default, priority/assignee, validates UUID, revalidates on success.
- Wrappers (`(admin)/admin/projects/[projectId]/board/page.tsx`, `(workers)/projects/[projectId]/board/page.tsx`) — server components: `getCurrentUser`, `getProject` (membership check via RLS), `listTasks({projectId, page:1, pageSize:100})`, render `<Board projectId initialTasks isAdmin />`. Both updated in T8 (previous placeholders replaced).

## Dashboard Widget

- `apps/web/app/(dashboard)/dashboard/page.tsx` — server page `/dashboard`, `getCurrentUser`, renders `MyCardsWidget`. Mentioned in T8 spec as alternative dashboard location.
- `components/dashboard/MyCardsWidget.tsx` — async server component calling `listMyCards({page:1, pageSize:10})`, displays priority badge, project link to `/projects/[id]/board`, note about RLS + ordering.
- `components/dashboard/MyCardsClient.tsx` — client counterpart for `workspace/dashboard` (module placeholder), `useEffect` + `listMyCards`, same UI.
- `components/module-placeholder.tsx` — updated to render `MyCardsClient` when `module.slug === "dashboard"` so `/workspace/dashboard` also shows the widget.

## Verification (T9)

Run:

```bash
node scripts/verify-workers-rls.mjs
npm run typecheck --workspace @turing-itsm/web
npm run typecheck  # root (workspaces)
```

Script checks migration policies, validation, task exports, board @dnd-kit usage, wrappers fetching via `listTasks`, dashboard calling `listMyCards`, and dependency installation. It exits 0 on pass.

Manual RLS checklist (for Supabase review):

- [ ] Worker not in `project_members` cannot `select` project nor tasks (`projects_select_scoped`, `tasks_select_scoped`)
- [ ] Worker cannot `insert` task into project not member of (`tasks_insert_member` with_check fails → 403)
- [ ] Worker can `update` own project's tasks status via drag (`tasks_update_member` both using/with_check)
- [ ] Worker cannot `delete` tasks (only `tasks_delete_admin`)
- [ ] `is_admin()` respects `profiles.role`; try toggling role and re-testing policies
- [ ] `daily_checkins_update_own_today` only allows same UTC day edit
- [ ] Verify via Supabase dashboard: set `auth.uid()` to worker JWT and run `select * from tasks` vs expected subset

No `apps/api` changes per requirement.

## Commits (this PR, exception size — 9 tasks)

```
b21266f chore(db): add workers daily tasks migration, types and validation (T1)
67b29de feat(workers): add RBAC helpers, auth guards and daily check-in actions (T2-T3)
56eb68e feat(projects): add projects backend Server Actions (T5)
c1c919f feat(daily): add worker check-in form with history and admin team table (T4)
cf5cc7d feat(projects): add admin and worker projects UI with board wrappers (T6)
e45504c feat(tasks): add tasks Server Actions with RLS and membership checks (T7)
073c67e feat(board): add Kanban Board, Columns, Cards with @dnd-kit and dashboard MyCards widget (T8)
<T9>   docs(rls): add verification script and workers-daily-tasks docs (T9)  ← this batch
```

Typecheck evidence: `npm run typecheck` passes on each batch (T7, T8, T9).
