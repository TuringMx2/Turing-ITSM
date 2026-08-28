"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SignOutSubmitButton } from "@/components/navigation/sign-out-submit-button";
import type { InternalRole } from "@/lib/rbac";
import { roleLabels } from "@/lib/rbac";

type UserDisclosureProps = {
	email?: string;
	name?: string;
	profileHref?: string;
	role: InternalRole;
	signOutAction: () => void | Promise<void>;
};

function getInitials(value: string) {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

export function UserDisclosure({
	email,
	name,
	profileHref,
	role,
	signOutAction,
}: UserDisclosureProps) {
	const pathname = usePathname();
	const [openPath, setOpenPath] = useState<string | null>(null);
	const disclosureId = useId();
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const displayName = name?.trim() || email?.trim() || "Usuario interno";
	const initials = getInitials(displayName) || "UI";
	const open = openPath === pathname;

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setOpenPath(null);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpenPath(null);
			triggerRef.current?.focus();
		};

		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	return (
		<div className="tmx-user-menu" ref={containerRef}>
			<button
				aria-controls={disclosureId}
				aria-expanded={open}
				aria-label={`${open ? "Cerrar" : "Abrir"} menú de ${displayName}`}
				className="tmx-user-menu__trigger"
				onClick={() =>
					setOpenPath((current) => (current === pathname ? null : pathname))
				}
				ref={triggerRef}
				type="button"
			>
				<span aria-hidden="true" className="tmx-user-menu__avatar">
					{initials}
				</span>
				<span className="tmx-user-menu__trigger-copy">
					<strong>{displayName}</strong>
					<small>{roleLabels[role]}</small>
				</span>
				<svg aria-hidden="true" viewBox="0 0 16 16">
					<path d="m4 6 4 4 4-4" />
				</svg>
			</button>

			{open ? (
				<div className="tmx-user-menu__panel" id={disclosureId}>
					<div className="tmx-user-menu__identity">
						<strong>{displayName}</strong>
						<span>{email?.trim() || "Correo no disponible"}</span>
						<small>{roleLabels[role]}</small>
					</div>
					{profileHref ? (
						<Link
							aria-current={
								pathname === profileHref || pathname.startsWith(`${profileHref}/`)
									? "page"
									: undefined
							}
							className="tmx-user-menu__link"
							href={profileHref}
							onClick={() => setOpenPath(null)}
						>
							Mi perfil
						</Link>
					) : null}
					<form action={signOutAction}>
						<SignOutSubmitButton />
					</form>
				</div>
			) : null}
		</div>
	);
}
