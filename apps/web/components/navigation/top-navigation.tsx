"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { UserDisclosure } from "@/components/navigation/user-disclosure";
import {
	roleModules,
	type AppModule,
	type InternalRole,
} from "@/lib/rbac";

export type TopNavigationProps = {
	user: {
		email?: string;
		name?: string;
		role: InternalRole;
	};
};

function getModuleHref(module: AppModule) {
	return module.href ?? `/workspace/${module.slug}`;
}

function isActivePath(pathname: string, href: string) {
	return pathname === href || pathname.startsWith(`${href}/`);
}

function isModuleActive(pathname: string, module: AppModule) {
	return (
		isActivePath(pathname, getModuleHref(module)) ||
		(module.slug === "projects" && pathname.startsWith("/admin/projects"))
	);
}

export function TopNavigation({ user }: TopNavigationProps) {
	const pathname = usePathname();
	const [modulesOpenPath, setModulesOpenPath] = useState<string | null>(null);
	const modulesId = useId();
	const modulesRef = useRef<HTMLDivElement>(null);
	const modulesTriggerRef = useRef<HTMLButtonElement>(null);
	const authorizedModules = roleModules[user.role];
	const primaryModuleSlugs = new Set([
		"dashboard",
		"daily",
		...(user.role === "admin" ? ["roles-permisos"] : []),
	]);
	const primaryModules = authorizedModules.filter((module) =>
		primaryModuleSlugs.has(module.slug),
	);
	const profileModule = authorizedModules.find(
		(module) => module.slug === "mi-perfil",
	);
	const disclosureModules = authorizedModules.filter(
		(module) =>
			!primaryModuleSlugs.has(module.slug) && module.slug !== "mi-perfil",
	);
	const hasActiveDisclosureModule = disclosureModules.some((module) =>
		isModuleActive(pathname, module),
	);
	const homeActive = pathname === "/workspace/home";
	const modulesOpen = modulesOpenPath === pathname;

	useEffect(() => {
		if (!modulesOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			if (!modulesRef.current?.contains(event.target as Node)) {
				setModulesOpenPath(null);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setModulesOpenPath(null);
			modulesTriggerRef.current?.focus();
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [modulesOpen]);

	return (
		<header className="tmx-top-nav">
			<a className="skip-link" href="#main-content">
				Ir al contenido principal
			</a>
			<div className="tmx-top-nav__inner">
				<Link
					aria-current={homeActive ? "page" : undefined}
					className="tmx-top-nav__brand"
					href="/workspace/home"
					translate="no"
				>
					<span aria-hidden="true">
						<Image alt="" height={30} src="/logo.png" width={30} />
					</span>
					<strong>TuringMx</strong>
				</Link>

				<nav aria-label="Navegación principal" className="tmx-top-nav__links">
					{primaryModules.map((module) => {
						const href = getModuleHref(module);
						const active = isActivePath(pathname, href);

						return (
							<Link
								aria-current={active ? "page" : undefined}
								className={`tmx-nav-link${active ? " is-active" : ""}`}
								href={href}
								key={module.slug}
							>
								{module.label}
							</Link>
						);
					})}

					{disclosureModules.length > 0 ? (
						<div className="tmx-modules-menu" ref={modulesRef}>
							<button
								aria-label={hasActiveDisclosureModule ? "Módulos, contiene la página actual" : undefined}
								aria-controls={modulesId}
								aria-expanded={modulesOpen}
								className={`tmx-nav-link tmx-modules-menu__trigger${
									hasActiveDisclosureModule ? " is-active" : ""
								}`}
								onClick={() =>
									setModulesOpenPath((current) =>
										current === pathname ? null : pathname,
									)
								}
								ref={modulesTriggerRef}
								type="button"
							>
								Módulos
								<svg aria-hidden="true" viewBox="0 0 16 16">
									<path d="m4 6 4 4 4-4" />
								</svg>
							</button>
							{modulesOpen ? (
								<div className="tmx-modules-menu__panel" id={modulesId}>
									{disclosureModules.map((module) => {
										const href = getModuleHref(module);
										const active = isModuleActive(pathname, module);

										return (
											<Link
												aria-current={active ? "page" : undefined}
												className={active ? "is-active" : undefined}
												href={href}
												key={module.slug}
												onClick={() => setModulesOpenPath(null)}
											>
												<strong>{module.label}</strong>
												<span>{module.description}</span>
											</Link>
										);
									})}
								</div>
							) : null}
						</div>
					) : null}
				</nav>

				<UserDisclosure
					email={user.email}
					name={user.name}
					profileHref={profileModule ? getModuleHref(profileModule) : undefined}
					role={user.role}
					signOutAction={signOut}
				/>
			</div>
		</header>
	);
}
