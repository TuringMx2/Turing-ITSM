import Link from "next/link";

export default function HomePage() {
	return (
		<main className="page-shell centered-shell">
			<section className="hero-card">
				<p className="eyebrow">Turing ITSM MVP</p>
				<h1>Login y navegación RBAC por rol.</h1>
				<p className="muted">
					Estructura inicial para validar cuatro roles, sidebars dinámicas,
					módulos permitidos y cierre de sesión antes de conectar Supabase Auth.
				</p>
				<Link className="primary-link" href="/login">
					Ir al login
				</Link>
			</section>
		</main>
	);
}
