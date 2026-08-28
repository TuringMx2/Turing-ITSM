import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { RolesPermissionsAdmin } from "@/components/admin/roles-permissions-admin";
import { DailyWorkspace } from "@/components/daily/daily-workspace";
import { MyCardsWidget } from "@/components/dashboard/MyCardsWidget";
import { WorkspaceModule } from "@/components/workspace-module";
import { getCurrentInternalUser } from "@/lib/auth";
import { getModuleForRole, isAdmin, roleHome } from "@/lib/rbac";

type WorkspacePageProps = {
	params: Promise<{ module: string }>;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
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

	return (
		<AppShell moduleSlug={module} user={user}>
			{isRolesPermissions ? (
				<Suspense
					fallback={
						<section className="card access-denied-card" aria-busy="true">
							<p className="eyebrow">Admin</p>
							<h1>Loading Roles &amp; Permissions…</h1>
							<p aria-live="polite" className="muted" role="status">Loading tenant staff, teams, projects, and assignments.</p>
						</section>
					}
				>
					<RolesPermissionsAdmin />
				</Suspense>
			) : isDaily ? (
				<Suspense
					fallback={
						<section className="card access-denied-card" aria-busy="true">
							<p className="eyebrow">Daily</p>
							<h1>Cargando Daily…</h1>
							<p aria-live="polite" className="muted" role="status">Preparando la configuración y las respuestas del equipo.</p>
						</section>
					}
				>
					<DailyWorkspace role={user.role} />
				</Suspense>
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
					<Suspense
						fallback={
							<section className="card dashboard-cards-widget" aria-busy="true">
								<h2 className="dashboard-widget-title">Mis tareas</h2>
								<p aria-live="polite" className="muted small-text" role="status">Cargando tareas…</p>
							</section>
						}
					>
						<MyCardsWidget />
					</Suspense>
				</section>
			) : (
				<WorkspaceModule moduleSlug={module} role={user.role} />
			)}
		</AppShell>
	);
}
