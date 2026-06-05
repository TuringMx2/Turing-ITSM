"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
	getMockSession,
	getRoleLabel,
	logoutMockUser,
	type MockSession,
} from "@/lib/mock-auth";
import { getModuleForRole, roleModules } from "@/lib/rbac";

type AppShellProps = {
	children: ReactNode;
	moduleSlug: string;
};

export function AppShell({ children, moduleSlug }: AppShellProps) {
	const pathname = usePathname();
	const router = useRouter();
	const [session, setSession] = useState<MockSession | null>(null);
	const [hasCheckedSession, setHasCheckedSession] = useState(false);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			const currentSession = getMockSession();
			if (!currentSession) {
				router.replace("/login");
				setHasCheckedSession(true);
				return;
			}

			setSession(currentSession);
			setHasCheckedSession(true);
		}, 0);

		return () => window.clearTimeout(timer);
	}, [router]);

	const activeModule = useMemo(() => {
		if (!session) {
			return null;
		}

		return getModuleForRole(session.role, moduleSlug);
	}, [moduleSlug, session]);

	function handleLogout() {
		logoutMockUser();
		router.replace("/login");
	}

	if (!hasCheckedSession || !session) {
		return (
			<main className="page-shell centered-shell">
				<p className="muted">Validando sesión...</p>
			</main>
		);
	}

	const navigation = roleModules[session.role];

	return (
		<div className="app-layout">
			<aside className="sidebar">
				<div>
					<p className="eyebrow">Turing ITSM</p>
					<h2>{getRoleLabel(session.role)}</h2>
					<p className="muted small-text">{session.name}</p>
					{session.tenantName ? (
						<p className="tenant-pill">{session.tenantName}</p>
					) : null}
				</div>

				<nav className="sidebar-nav" aria-label="Módulos por rol">
					{navigation.map((item) => {
						const href = `/workspace/${item.slug}`;
						const isActive = pathname === href;

						return (
							<Link
								className={isActive ? "nav-link active" : "nav-link"}
								href={href}
								key={item.slug}
							>
								{item.label}
							</Link>
						);
					})}
				</nav>

				<button className="logout-button" onClick={handleLogout} type="button">
					Cerrar sesión
				</button>
			</aside>

			<main className="content-shell">
				{!activeModule ? (
					<section className="card access-denied-card">
						<p className="eyebrow">Acceso denegado</p>
						<h1>Módulo no disponible para tu rol</h1>
						<p className="muted">
							La sidebar solo muestra los módulos permitidos. Si navegaste
							manualmente a esta URL, el guard de ruta bloquea la vista para
							mantener la separación por rol.
						</p>
						<Link className="primary-link" href="/workspace/dashboard">
							Volver al dashboard
						</Link>
					</section>
				) : (
					children
				)}
			</main>
		</div>
	);
}
