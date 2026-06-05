import {
	roleLabels,
	rolePermissions,
	type AppModule,
	type Role,
} from "@/lib/rbac";

type ModulePlaceholderProps = {
	module: AppModule;
	role: Role;
};

export function ModulePlaceholder({ module, role }: ModulePlaceholderProps) {
	const highlightedPermissions = rolePermissions[role].slice(0, 8);

	return (
		<section className="module-page">
			<p className="eyebrow">{roleLabels[role]}</p>
			<h1>{module.label}</h1>
			<p className="muted">{module.description}</p>

			<div className="card-grid two-columns">
				<article className="card">
					<h2>Placeholder funcional</h2>
					<p className="muted">
						Esta pantalla existe para validar navegación, layout y permisos
						visuales. La lógica de negocio real se agregará módulo por módulo.
					</p>
				</article>
				<article className="card">
					<h2>Permisos base del rol</h2>
					<ul className="permission-list">
						{highlightedPermissions.map((permission) => (
							<li key={permission}>{permission}</li>
						))}
					</ul>
				</article>
			</div>
		</section>
	);
}
