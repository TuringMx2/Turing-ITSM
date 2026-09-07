#!/usr/bin/env node

/**
 * Bounded static verification for the rebuilt local migration chain.
 * This script verifies file lineage and selected structural controls. It does not
 * execute PostgreSQL, prove RLS behavior, or replace a clean local database reset.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname ?? ".", "..");
const migrationsDir = join(root, "supabase", "migrations");
const legacyDir = join(root, "supabase", "legacy_migrations");

const expectedMigrations = [
  "202608250100_ticketing_identity_baseline.sql",
  "202608250200_organization_teams_projects.sql",
  "202608250300_daily_questions_schedules_submissions.sql",
  "202608250400_project_workflows_tasks_activity.sql",
  "202608250500_task_consistency_hardening.sql",
  "202608250600_account_status_and_management.sql",
  "202608250650_superadmin_role_enum.sql",
  "202608250700_superadmin_role_access.sql",
  "202608250800_self_registration.sql",
  "202608250900_authorization_refinement.sql",
  "202608251000_daily_run_scheduler.sql",
  "202608251100_registration_full_name.sql",
  "202608251200_daily_selected_date_integrity.sql",
  "202608251300_daily_task_planning_completion.sql",
  "202608251400_task_effort_estimates.sql",
  "202609051100_current_sprint_tasks.sql",
];

const expectedLegacy = new Map([
  ["20260605_initial_itsm_schema.sql", { bytes: 25437, sha256: "5dbc74e12b86540e191a6ce16ce9438b50e59f1c0d7786aa0a9a5f2f8077e3cb" }],
  ["20260806_initial_itsm_schema.sql", { bytes: 42834, sha256: "742cb7c778c700ed95ab5715ec969fd20b216167763926ec472e1672e5d2044f" }],
  ["20260825_workers_daily_tasks.sql", { bytes: 10589, sha256: "25aba5ec4564e9289997a3d5980eb6010c69c178d898e0b5955a92ab48f3c4b3" }],
]);

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

check("migration directory exists", existsSync(migrationsDir));
check("legacy migration directory exists", existsSync(legacyDir));

const migrationNames = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()
  : [];
check("executable chain contains exactly the sixteen expected migrations", JSON.stringify(migrationNames) === JSON.stringify(expectedMigrations));
check("migration filenames are already in deterministic lexical order", JSON.stringify(migrationNames) === JSON.stringify([...migrationNames].sort()));

for (const [name, expected] of expectedLegacy) {
  const path = join(legacyDir, name);
  check(`legacy file exists: ${name}`, existsSync(path));
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  check(`legacy byte length preserved: ${name}`, bytes.length === expected.bytes);
  check(`legacy SHA-256 preserved: ${name}`, sha256(bytes) === expected.sha256);
  check(`legacy file is not executable: ${name}`, !existsSync(join(migrationsDir, name)));
}

const migrationSql = migrationNames.map((name) => ({
  name,
  sql: readFileSync(join(migrationsDir, name), "utf8"),
}));
const allSql = migrationSql.map(({ sql }) => sql).join("\n");
const selectedDateMigrationSql = migrationSql.find(({ name }) => name === "202608251200_daily_selected_date_integrity.sql")?.sql ?? "";
const taskEstimateMigrationSql = migrationSql.find(({ name }) => name === "202608251400_task_effort_estimates.sql")?.sql ?? "";
const currentSprintMigrationSql = migrationSql.find(({ name }) => name === "202609051100_current_sprint_tasks.sql")?.sql ?? "";

for (const { name, sql } of migrationSql) {
  const dollarQuotes = sql.match(/\$\$/g)?.length ?? 0;
  check(`balanced anonymous dollar quotes: ${name}`, dollarQuotes % 2 === 0);

  const definerFunctions = sql.match(/create (?:or replace )?function[\s\S]*?\$\$;/gi) ?? [];
  for (const block of definerFunctions.filter((value) => /security definer/i.test(value))) {
    const signature = block.match(/create (?:or replace )?function\s+([^\s(]+\s*\([^)]*\))/i)?.[1] ?? "unknown";
    check(`SECURITY DEFINER has fixed empty search_path: ${signature}`, /set search_path\s*=\s*''/i.test(block));
  }
}

const createdTables = [...allSql.matchAll(/create table\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
const createdTypes = [...allSql.matchAll(/create type\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
const createdIndexes = [...allSql.matchAll(/create (?:unique )?index\s+([a-z0-9_]+)/gi)].map((match) => match[1]);
const createdFunctions = [...allSql.matchAll(/create function\s+([a-z0-9_.]+)/gi)].map((match) => match[1]);
const referencedPublicTables = [...allSql.matchAll(/references\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
check("no duplicate public table definitions", new Set(createdTables).size === createdTables.length);
check("no duplicate public type definitions", new Set(createdTypes).size === createdTypes.length);
check("no duplicate index names", new Set(createdIndexes).size === createdIndexes.length);
check("no duplicate function names", new Set(createdFunctions).size === createdFunctions.length);
check("all public foreign-key targets are defined in the chain", referencedPublicTables.every((name) => createdTables.includes(name)));

for (const table of createdTables) {
  check(`RLS enabled: public.${table}`, new RegExp(`alter table\\s+public\\.${table}\\s+enable row level security`, "i").test(allSql));
}

const requiredControls = [
  ["all five ticket roles retained", /create type public\.app_role[\s\S]*'customer_user'[\s\S]*'customer_manager'[\s\S]*'support_agent'[\s\S]*'admin'[\s\S]*alter type public\.app_role add value if not exists 'superadmin'/i],
  ["global role-only admin helper is absent", !/private\.is_admin\s*\(/i.test(allSql)],
  ["tenant admin helper accepts tenant-scoped admin-equivalent roles", /create or replace function private\.is_tenant_admin\(p_tenant_id uuid\)[\s\S]*private\.current_role\(\) in \('admin', 'superadmin'\)[\s\S]*private\.current_tenant_id\(\) = p_tenant_id/i],
  ["team membership helper requires tenant and team", /create function private\.is_team_member\(p_tenant_id uuid, p_team_id uuid\)/i],
  ["project authorization helper requires tenant and project", /create function private\.can_manage_project\(p_tenant_id uuid, p_project_id uuid\)/i],
  ["organization policies pass row tenant to admin checks", /private\.is_tenant_admin\(tenant_id\)[\s\S]*private\.is_team_member\(tenant_id, team_id\)[\s\S]*private\.is_project_member\(tenant_id, project_id\)/i],
  ["task and storage authorization pass tenant and project", /private\.can_manage_project\(tenant_id, project_id\)[\s\S]*private\.can_manage_project\(a\.tenant_id, a\.project_id\)/i],
  ["active-project helper binds tenant, project, access, and archive state", /create function private\.can_manage_active_project\([\s\S]*private\.can_manage_project\(p_tenant_id, p_project_id\)[\s\S]*p\.tenant_id = p_tenant_id[\s\S]*p\.id = p_project_id[\s\S]*p\.archived_at is null/i],
  ["task-domain write policies require active-project access", /create policy project_workflow_columns_insert_scope[\s\S]*private\.can_manage_active_project\(tenant_id, project_id\)[\s\S]*create policy tasks_update_scope[\s\S]*private\.can_manage_active_project\(tenant_id, project_id\)[\s\S]*create policy task_assignees_delete_scope[\s\S]*private\.can_manage_active_project\(tenant_id, project_id\)[\s\S]*create policy task_comments_insert_scope[\s\S]*private\.can_manage_active_project\(tenant_id, project_id\)[\s\S]*create policy task_attachments_delete_scope[\s\S]*private\.can_manage_active_project\(tenant_id, project_id\)/i],
  ["task Storage writes require active-project access", /create policy task_attachment_objects_insert[\s\S]*private\.can_manage_active_project\(a\.tenant_id, a\.project_id\)[\s\S]*create policy task_attachment_objects_delete[\s\S]*private\.can_manage_active_project\(a\.tenant_id, a\.project_id\)/i],
  ["assignee replacement locks task and project before exact replacement", /create function public\.replace_task_assignees\(\s*p_task_id uuid,\s*p_assignee_ids uuid\[\][\s\S]*for update of t, p[\s\S]*delete from public\.task_assignees[\s\S]*insert into public\.task_assignees/i],
  ["assignee replacement validates same-project memberships", /create function public\.replace_task_assignees[\s\S]*public\.project_memberships pm[\s\S]*pm\.tenant_id = v_tenant_id[\s\S]*pm\.project_id = v_project_id[\s\S]*pm\.user_id = any\(v_assignee_ids\)/i],
  ["assignee RPC revokes API roles before authenticated-only grant", /revoke all on function public\.replace_task_assignees\(uuid, uuid\[\]\)[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.replace_task_assignees\(uuid, uuid\[\]\) to authenticated;/i],
  ["My Cards RPC filters current user and active projects before database pagination", /create function public\.list_my_cards[\s\S]*ta\.user_id = \(select auth\.uid\(\)\)[\s\S]*p\.archived_at is null[\s\S]*order by[\s\S]*limit least[\s\S]*offset greatest[\s\S]*count\(\*\) from visible_cards/i],
  ["My Cards RPC revokes API roles before authenticated-only grant", /revoke all on function public\.list_my_cards\(integer, integer\)[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.list_my_cards\(integer, integer\) to authenticated;/i],
  ["task estimates keep legacy due dates nullable", /alter table public\.tasks[\s\S]*alter column due_date drop not null/i.test(taskEstimateMigrationSql)],
  ["task estimates require a complete positive quantity and supported unit", /add constraint tasks_estimate_check check \([\s\S]*estimate_quantity is null and estimate_unit is null[\s\S]*estimate_quantity > 0[\s\S]*estimate_unit in \('hours', 'days'\)/i.test(taskEstimateMigrationSql)],
  ["replacement My Cards RPC exposes estimates without due-date sorting", /create or replace function public\.list_my_cards[\s\S]*t\.estimate_quantity[\s\S]*t\.estimate_unit[\s\S]*order by priority_rank desc, visible\.created_at desc, visible\.id[\s\S]*grant execute on function public\.list_my_cards\(integer, integer\) to authenticated;/i.test(taskEstimateMigrationSql)],
  ["current sprint migration backfills existing tasks before requiring a destination", /add column is_current_sprint boolean[\s\S]*update public\.tasks[\s\S]*set is_current_sprint = true[\s\S]*alter column is_current_sprint set not null/i.test(currentSprintMigrationSql)],
  ["current sprint migration indexes board ordering and filters My Cards", /create index tasks_current_sprint_project_column_position_idx[\s\S]*where is_current_sprint[\s\S]*create or replace function public\.list_my_cards[\s\S]*t\.is_current_sprint/i.test(currentSprintMigrationSql)],
  ["Daily questions are tenant-scoped", /create table public\.daily_questions[\s\S]*tenant_id uuid not null references public\.tenants/i],
  ["actor references use composite tenant/profile integrity", /foreign key \(tenant_id, created_by\)[\s\S]*references public\.profiles \(tenant_id, id\)[\s\S]*foreign key \(tenant_id, actor_user_id\)[\s\S]*references public\.profiles \(tenant_id, id\)/i],
  ["resolve RPC revokes all API roles before exact grant", /revoke execute on function public\.resolve_ticket_access\(text\) from public, anon, authenticated, service_role;\s*revoke[\s\S]*grant execute on function public\.resolve_ticket_access\(text\) to anon, authenticated, service_role;/i],
  ["comment RPC revokes all API roles before exact grant", /revoke execute on function public\.add_ticket_public_comment_by_token\(text, text\) from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.add_ticket_public_comment_by_token\(text, text\) to anon, authenticated, service_role;/i],
  ["token mint RPC revokes all API roles before exact grant", /revoke execute on function public\.create_ticket_access_token\(uuid, text, text, timestamptz, uuid\) from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.create_ticket_access_token\(uuid, text, text, timestamptz, uuid\) to authenticated, service_role;/i],
  ["profile provisioning RPC revokes all API roles before exact grant", /revoke execute on function public\.provision_profile\(uuid, public\.app_role, uuid, text, text\) from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.provision_profile\(uuid, public\.app_role, uuid, text, text\) to authenticated;/i],
  ["Daily submission RPC revokes all API roles before exact grant", /revoke execute on function public\.submit_daily_response\(uuid\[\], jsonb, date\) from public, anon, authenticated, service_role;\s*grant execute on function public\.submit_daily_response\(uuid\[\], jsonb, date\) to authenticated;/i],
  ["Daily submission RPC requires the selected local date", /create or replace function public\.submit_daily_response\([\s\S]*p_local_date date/i],
  ["Daily submission RPC rejects run dates that differ from the selected date", /create or replace function public\.submit_daily_response\([\s\S]*r\.local_date is distinct from p_local_date[\s\S]*The Daily runs do not match the selected local date[\s\S]*insert into public\.daily_submissions/i],
  ["Daily questions carry stable semantic metadata", /alter table public\.daily_questions[\s\S]*add column semantic_key text[\s\S]*daily_questions_semantic_key_check/i],
  ["Daily task items are separate from project tasks and tenant scoped", /create table public\.daily_task_items[\s\S]*tenant_id uuid not null[\s\S]*daily_task_items_team_tenant_fk/i],
  ["Daily task items preserve team and user ownership", /create table public\.daily_task_items[\s\S]*foreign key \(tenant_id, team_id\)[\s\S]*foreign key \(tenant_id, user_id\)/i],
  ["Daily task inserts use an authenticated server RPC", allSql.includes("create function public.add_daily_task_items") && allSql.includes("revoke insert, update, delete on public.daily_task_items from authenticated") && allSql.includes("grant execute on function public.add_daily_task_items(uuid, date, text[]) to authenticated;")],
  ["Daily completion is unique per team user and logical date", /create table public\.daily_task_completions[\s\S]*unique \(tenant_id, team_id, user_id, logical_date\)/i],
  ["Daily completion snapshots are immutable", /create function private\.prevent_daily_task_completion_change\(\)[\s\S]*Daily task completion evidence is immutable[\s\S]*create trigger prevent_daily_task_completion_item_change/i],
  ["Daily response task wrapper derives tasks from the canonical answer", /create function public\.submit_daily_response_with_tasks\([\s\S]*p_planned_task_titles text\[\][\s\S]*task titles are never trusted[\s\S]*rq\.semantic_key = 'planned_work'[\s\S]*jsonb_array_elements\(p_answers\)[\s\S]*regexp_split_to_table[\s\S]*public\.submit_daily_response\(p_run_ids, p_answers, p_local_date\)[\s\S]*insert into public\.daily_task_items[\s\S]*revoke all on function public\.submit_daily_response_with_tasks\(uuid\[\], jsonb, date, text\[\]\) from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.submit_daily_response_with_tasks\(uuid\[\], jsonb, date, text\[\]\) to authenticated;/i],
  ["Daily response wrapper closes the legacy authenticated alternate path", /grant execute on function public\.submit_daily_response_with_tasks\(uuid\[\], jsonb, date, text\[\]\) to authenticated;[\s\S]*revoke execute on function public\.submit_daily_response\(uuid\[\], jsonb, date\) from authenticated;/i],
  ["Daily completion RPC uses the team IANA timezone and server cutoff", allSql.includes("v_local_now := clock_timestamp() at time zone v_schedule.timezone_name;") && allSql.includes("v_local_now::time < time '16:00'") && allSql.includes("p_logical_date <> v_local_now::date")],
  ["Daily completion RPC locks tasks and permits only delete or carry", allSql.includes("for update") && allSql.includes("not in ('delete', 'carry')") && allSql.includes("p_unchecked_resolution = 'carry'")],
  ["Daily completion RPC is authenticated only", /revoke all on function public\.submit_daily_task_completion\(uuid, date, uuid\[\], text\) from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.submit_daily_task_completion\(uuid, date, uuid\[\], text\) to authenticated;/i],
  ["Daily task reads exclude team-wide member access", (() => {
    const items = allSql.match(/create policy daily_task_items_read_scope[\s\S]*?create policy daily_task_items_insert_scope/i)?.[0] ?? "";
    const completions = allSql.match(/create policy daily_task_completions_read_scope[\s\S]*?create policy daily_task_completion_items_read_scope/i)?.[0] ?? "";
    const completionItems = allSql.match(/create policy daily_task_completion_items_read_scope[\s\S]*?grant select on public\.daily_task_items/i)?.[0] ?? "";
    return [items, completions, completionItems].every((policy) => policy.includes("user_id = (select auth.uid())") && !policy.includes("private.is_team_member"));
  })()],
  ["Daily response task positions use the shared transaction lock", /submit_daily_response_with_tasks[\s\S]*pg_catalog\.pg_advisory_xact_lock\([\s\S]*v_tenant_id::text \|\| ':' \|\| v_team_id::text \|\| ':' \|\| p_local_date::text \|\| ':' \|\| v_user_id::text[\s\S]*select coalesce\(max\(t\.position\)/i],
  ["anonymous cannot mint ticket tokens", !/grant execute on function public\.create_ticket_access_token[^;]*\bto\b[^;]*\banon\b/i.test(allSql)],
  ["token mint uses explicit trusted service-role claim", /coalesce\(auth\.role\(\), ''\) <> 'service_role'[\s\S]*private\.is_tenant_admin\(v_tenant_id\)/i],
  ["token mint does not trust a null auth uid", !/create_ticket_access_token[\s\S]*auth\.uid\(\) is null/i.test(allSql)],
  ["ticket number sequence privileges are explicit", /revoke all on sequence public\.ticket_number_seq from public, anon, authenticated, service_role;\s*grant usage, select on sequence public\.ticket_number_seq to authenticated, service_role;/i],
  ["team and project memberships are separate", /create table public\.team_memberships/i],
  ["explicit project memberships exist", /create table public\.project_memberships/i],
  ["project-member removal cascades task assignments", /task_assignees_project_member_fk[\s\S]*references public\.project_memberships[\s\S]*on delete cascade/i],
  ["task assignee membership enforced by composite FK", /foreign key \(tenant_id, project_id, user_id\)[\s\S]*references public\.project_memberships \(tenant_id, project_id, user_id\)/i],
  ["task column belongs to task project", /tasks_column_project_fk[\s\S]*foreign key \(tenant_id, project_id, column_id\)/i],
  ["nonempty workflow column deletion blocked", /A workflow column containing tasks cannot be deleted/i],
  ["team question positions enforce a maximum of three", /team_daily_questions_position_check check \(position between 1 and 3\)/i],
  ["team question selection locks and rechecks the catalog row", /create function private\.validate_team_daily_question\(\)[\s\S]*q\.tenant_id = new\.tenant_id[\s\S]*q\.is_active[\s\S]*for share;[\s\S]*if not found/i],
  ["question deactivation removes team selections", /delete from public\.team_daily_questions[\s\S]*question_id = old\.id/i],
  ["canonical questions cannot be hard-deleted", /Daily questions must be soft-deactivated, not deleted/i],
  ["daily runs use timestamptz occurrences", /scheduled_for timestamptz not null/i],
  ["Daily runs are unique per team-local date", /unique \(team_id, local_date\)/i],
  ["Daily run rows reject every post-insert change", /create function private\.prevent_daily_run_change\(\)[\s\S]*to_jsonb\(new\) is distinct from to_jsonb\(old\)[\s\S]*Daily run schedule-derived occurrence evidence is immutable/i],
  ["authenticated callers have no Daily run update grant", !/grant[^;]*update[^;]*public\.daily_runs/i.test(allSql)],
  ["Daily runs expose no update policy", !/create policy[^;]*on public\.daily_runs[^;]*for update/i.test(allSql)],
  ["daily submission answers preserve question text", /create table public\.daily_submission_answers[\s\S]*question_text text not null/i],
  ["daily submission evidence is immutable", /Submitted Daily responses and their evidence are immutable/i],
  ["Daily answer visibility is question-scoped", /can_read_daily_answer\(submission_id, question_id\)/i],
  ["task activity has no authenticated insert grant", !/grant[^;]*insert[^;]*public\.task_activity/i.test(allSql)],
  ["task activity update and delete are blocked", /Task activity is append-only/i],
  ["ticket attachment bucket remains private", /'ticket-attachments', 'ticket-attachments', false/i],
  ["task attachment bucket is separate and private", /'task-attachments', 'task-attachments', false/i],
  ["self-registration trigger is attached only to auth user inserts", /create trigger on_auth_user_created_self_registration\s+after insert on auth\.users[\s\S]*execute function private\.provision_self_registered_profile\(\)/i],
  ["self-registration provisioning uses a fixed active support role", /create function private\.provision_self_registered_profile\(\)[\s\S]*insert into public\.profiles\s*\(\s*id,\s*tenant_id,\s*role,\s*full_name,\s*email,\s*status\s*\)[\s\S]*'support_agent'[\s\S]*'active'/i],
  ["self-registration resolves the active tenant by slug or name", /create function private\.provision_self_registered_profile\(\)[\s\S]*t\.status = 'active'[\s\S]*t\.slug = 'turing-itsm'[\s\S]*lower\(btrim\(t\.name\)\) = 'turing itsm'/i],
  ["self-registration fails when no unique active tenant exists", /create function private\.provision_self_registered_profile\(\)[\s\S]*select t\.id\s+into strict v_tenant_id/i],
  ["self-registration replacement normalizes Auth full_name metadata", allSql.includes("v_full_name := regexp_replace(") && allSql.includes("new.raw_user_meta_data ->> 'full_name'") && allSql.includes("'\\s+'")],
  ["self-registration replacement rejects blank or oversized names", /create or replace function private\.provision_self_registered_profile\(\)[\s\S]*v_full_name = '' or char_length\(v_full_name\) > 160[\s\S]*raise exception 'Unable to provision self-registered account'/i],
  ["self-registration replacement preserves owner and revoked API access", /create or replace function private\.provision_self_registered_profile\(\)[\s\S]*alter function private\.provision_self_registered_profile\(\) owner to postgres;[\s\S]*revoke all on function private\.provision_self_registered_profile\(\) from public, anon, authenticated, service_role;/i],
  ["superadmin assignment helper is active and tenant-scoped", /create or replace function private\.is_tenant_superadmin\(p_tenant_id uuid\)[\s\S]*private\.is_active_user\(\)[\s\S]*private\.current_role\(\) = 'superadmin'[\s\S]*private\.current_tenant_id\(\) = p_tenant_id/i],
  ["profile provisioning restricts superadmin assignment to superadmins", /create or replace function public\.provision_profile\([\s\S]*p_role = 'superadmin' and not private\.is_tenant_superadmin\(p_tenant_id\)[\s\S]*Only an active superadmin for the target tenant may assign the superadmin role/i],
  ["direct superadmin inserts are tenant-scoped", /create policy profiles_admin_insert[\s\S]*private\.is_tenant_admin\(tenant_id\)[\s\S]*role <> 'superadmin' or private\.is_tenant_superadmin\(tenant_id\)/i],
  ["superadmin assignment trigger is security-definer and tenant-scoped", /create or replace function private\.prevent_unauthorized_superadmin_assignment\(\)[\s\S]*security definer[\s\S]*set search_path = ''[\s\S]*new\.role = 'superadmin'[\s\S]*not private\.is_tenant_superadmin\(new\.tenant_id\)/i],
  ["direct profile role changes require an active superadmin", /create or replace function private\.prevent_last_active_admin_change\(\)[\s\S]*new\.role is distinct from old\.role[\s\S]*current_setting\('app\.provision_profile', true\)[\s\S]*not private\.is_tenant_superadmin\(old\.tenant_id\)[\s\S]*Direct profile role updates require an active superadmin/i],
  ["ordinary role changes retain the controlled provisioning path", /perform pg_catalog\.set_config\('app\.provision_profile', 'true', true\)[\s\S]*on conflict \(id\) do update set[\s\S]*role = excluded\.role/i],
  ["profiles have an active/inactive account status", /alter table public\.profiles[\s\S]*status text not null default 'active'[\s\S]*profiles_status_check check \(status in \('active', 'inactive'\)\)/i],
  ["inactive users are excluded from shared authorization helpers", /create or replace function private\.is_active_user\(\)[\s\S]*p\.status = 'active'[\s\S]*create or replace function private\.is_tenant_admin[\s\S]*private\.is_active_user\(\)/i],
  ["last active admin-equivalent protection locks the tenant before counting", /create or replace function private\.prevent_last_active_admin_change\(\)[\s\S]*from public\.tenants where id = old\.tenant_id for update[\s\S]*p\.role in \('admin', 'superadmin'\)[\s\S]*A tenant must retain at least one active administrator/i],
  ["inactive profile reads are blocked by direct policy", /create policy profiles_read_scope[\s\S]*private\.is_active_user\(\)/i],
  ["superadmin permissions are copied from admin mappings", /insert into public\.role_permissions[\s\S]*select 'superadmin'::public\.app_role, rp\.permission_key[\s\S]*where rp\.role = 'admin'/i],
  ["Daily schedules use ISO weekdays", /team_daily_schedules_weekdays_check[\s\S]*scheduled_weekdays <@ array\[1, 2, 3, 4, 5, 6, 7\]::smallint\[\]/i],
  ["Daily scheduler ensures pg_cron", /create extension if not exists pg_cron/i],
  ["Daily scheduler is a locked-down SECURITY DEFINER", /create or replace function private\.generate_daily_runs\(\)[\s\S]*security definer[\s\S]*set search_path = ''[\s\S]*alter function private\.generate_daily_runs\(\) owner to postgres[\s\S]*revoke all on function private\.generate_daily_runs\(\) from public, anon, authenticated, service_role/i],
  ["Daily scheduler considers only active schedules and non-archived teams", /create or replace function private\.generate_daily_runs\(\)[\s\S]*from public\.team_daily_schedules s[\s\S]*join public\.teams t[\s\S]*where s\.is_active[\s\S]*t\.archived_at is null/i],
  ["Daily scheduler evaluates stored timezone and configured ISO weekday", /create or replace function private\.generate_daily_runs\(\)[\s\S]*v_local_now := v_now at time zone v_schedule\.timezone_name[\s\S]*extract\(isodow from v_local_now\)[\s\S]*v_schedule\.scheduled_weekdays/i],
  ["Daily scheduler relies on the Daily run trigger and local-date uniqueness", /insert into public\.daily_runs \(tenant_id, team_id, schedule_id, scheduled_for\)[\s\S]*on conflict \(team_id, local_date\) do nothing/i],
  ["Daily scheduler registration is five-minute and idempotent", /from cron\.job j[\s\S]*j\.jobname = 'daily-run-generator'[\s\S]*if not v_job_exists[\s\S]*cron\.schedule[\s\S]*'\*\/5 \* \* \* \*'/i],
];

for (const [label, expression] of requiredControls) {
  check(label, expression instanceof RegExp ? expression.test(allSql) : expression);
}

check(
  "Daily selected-date migration removes the old RPC signature before installing the new one",
  /drop function if exists public\.submit_daily_response\(uuid\[\], jsonb\);[\s\S]*create or replace function public\.submit_daily_response\([\s\S]*p_local_date date/i.test(
    selectedDateMigrationSql,
  ),
);

console.log("\nStatic verification only: PostgreSQL execution and authenticated RLS scenarios remain required.");
process.exitCode = failures === 0 ? 0 : 1;
