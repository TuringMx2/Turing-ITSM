"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AmbientField } from "@/components/landing/ambient-field";

export type WorkspaceLandingProps = {
	displayName: string;
};

const features = [
	{
		title: "Seguimiento diario",
		description: "Mantén el control de tus prioridades y el pulso del equipo.",
	},
	{
		title: "Tareas organizadas",
		description: "Gestiona y da seguimiento a tus pendientes desde un solo lugar.",
	},
	{
		title: "Flujo de trabajo",
		description: "Procesos más claros para mantener el trabajo en movimiento.",
	},
] as const;

function getLocalGreeting(hour: number): string {
	if (hour >= 4 && hour < 12) return "Buen día";
	if (hour >= 12 && hour < 19) return "Buenas tardes";
	return "Buenas noches";
}

function subscribeToClientMount(callback: () => void) {
	const timeout = setTimeout(callback, 0);
	return () => clearTimeout(timeout);
}

function getClientLocalGreeting(): string {
	return getLocalGreeting(new Date().getHours());
}

export function WorkspaceLanding({ displayName }: WorkspaceLandingProps) {
	const [motionPaused, setMotionPaused] = useState(false);
	const localGreeting = useSyncExternalStore(
		subscribeToClientMount,
		getClientLocalGreeting,
		() => null,
	);

	return (
		<section className="tmx-landing">
			<AmbientField paused={motionPaused} />
			<div className="tmx-landing__content">
				<div className="tmx-landing__hero">
					<p className="tmx-landing__kicker">Operations Workspace</p>
					{localGreeting ? (
						<h1>
							<span className="tmx-landing__greeting">{localGreeting},</span>
							<span className="tmx-landing__name">{displayName}</span>
						</h1>
					) : null}
					<p className="tmx-landing__description">
						Tu espacio operativo para organizar el día, dar seguimiento a tus
						tareas y mantener el trabajo en movimiento.
					</p>
					<nav aria-label="Accesos principales" className="tmx-landing__actions">
						<Link className="tmx-landing__primary-action" href="/workspace/dashboard">
							Abrir Dashboard
						</Link>
						<Link className="tmx-landing__secondary-action" href="/workspace/daily">
							Ir a Daily
						</Link>
					</nav>
				</div>

				<ul className="tmx-landing__features" aria-label="Funciones del espacio de trabajo">
					{features.map((feature) => (
						<li key={feature.title}>
							<span aria-hidden="true" />
							<div>
								<h2>{feature.title}</h2>
								<p>{feature.description}</p>
							</div>
						</li>
					))}
				</ul>
			</div>

			<button
				aria-pressed={motionPaused}
				className="tmx-motion-control"
				onClick={() => setMotionPaused((current) => !current)}
				type="button"
			>
				<span aria-hidden="true">{motionPaused ? "▶" : "Ⅱ"}</span>
				{motionPaused ? "Reanudar movimiento" : "Pausar movimiento"}
			</button>
		</section>
	);
}
