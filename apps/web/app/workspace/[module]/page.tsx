import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RolesPermissionsAdmin } from "@/components/admin/roles-permissions-admin";
import { DailyWorkspace } from "@/components/daily/daily-workspace";
import { MyCardsWidget } from "@/components/dashboard/MyCardsWidget";
import { DashboardDailyCard } from "@/components/dashboard/DashboardDailyCard";
import { getDailyMemberWorkspace } from "@/app/actions/daily-runs";
import { listMyCards } from "@/app/actions/tasks";
import { WorkspaceModule } from "@/components/workspace-module";
import { getCurrentInternalUser } from "@/lib/auth";
import { getModuleForRole, isAdmin, roleHome } from "@/lib/rbac";

type WorkspacePageProps = {
	params: Promise<{ module: string }>;
	searchParams?: Promise<{ dailyTeam?: string | string[] }>;
};

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
	const [{ module }, user] = await Promise.all([
		params,
		getCurrentInternalUser(),
	]);

	if (!user) {
		redirect("/login");
	}

	if (!getModuleForRole(user.role, module)) {
		redirect(roleHome[user.role]);
	}

	const isRolesPermissions = module === "roles-permisos" && isAdmin(user.role);
	const isDaily = module === "daily";
	const isDashboard = module === "dashboard";
	const search = isDashboard ? await searchParams : undefined;
	const requestedDashboardDailyTeam = typeof search?.dailyTeam === "string" ? search.dailyTeam : undefined;
	const dashboardData = isDashboard
		? await Promise.all([
				getDailyMemberWorkspace(requestedDashboardDailyTeam),
				listMyCards({ page: 1, pageSize: 10 }),
			])
		: null;

	return (
		<AppShell moduleSlug={module} user={user}>
			{isRolesPermissions ? (
				<RolesPermissionsAdmin />
			) : isDaily ? (
				<DailyWorkspace role={user.role} />
			) : isDashboard ? (
				<section className="module-page page-stack dashboard-page">
					<header className="page-header dashboard-page-header">
						<div>
							<p className="eyebrow">Dashboard</p>
							<h1>Tu trabajo en movimiento</h1>
							<p className="muted page-description">
								Revisá tus próximas tareas y retomá el trabajo desde el tablero del proyecto.
							</p>
						</div>
					</header>
					<div className="dashboard-workspace-grid">
						<DashboardDailyCard result={dashboardData?.[0] ?? { error: "No se pudo cargar Daily." }} />
						<MyCardsWidget result={dashboardData?.[1]} />
					</div>
				</section>
			) : (
				<WorkspaceModule moduleSlug={module} role={user.role} />
			)}
		</AppShell>
	);
}
