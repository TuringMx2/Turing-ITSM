import {
	roleLabels,
	type AppModule,
	type InternalRole,
} from "@/lib/rbac";
import { MyCardsClient } from "./dashboard/MyCardsClient";

type ModulePlaceholderProps = {
	module: AppModule;
	role: InternalRole;
};

export function ModulePlaceholder({ module, role }: ModulePlaceholderProps) {
	return (
		<section className="module-page page-stack">
			<header className="page-header">
				<div>
					<p className="eyebrow">{roleLabels[role]}</p>
					<h1>{module.label}</h1>
					<p className="muted">{module.description}</p>
				</div>
			</header>

			{module.slug === "dashboard" ? (
				<MyCardsClient />
			) : (
				<section className="card module-status-panel">
					<span className="status-badge neutral">En preparación</span>
					<h2>Este módulo todavía no está disponible</h2>
					<p className="muted">La navegación y el acceso ya están definidos. La experiencia operativa se incorporará en una próxima entrega.</p>
				</section>
			)}
		</section>
	);
}
