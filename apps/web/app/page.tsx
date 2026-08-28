import Link from "next/link";

export default function HomePage() {
	return (
		<main className="page-shell centered-shell">
			<section className="hero-card page-home-hero">
				<p className="eyebrow">Turing ITSM</p>
				<h1>Tu operación de servicios, en un solo lugar.</h1>
				<p className="muted">
					Gestioná proyectos, tareas y trabajo diario con la visibilidad que cada equipo necesita.
				</p>
				<Link className="primary-link page-home-link" href="/login">
					Ingresar
				</Link>
			</section>
		</main>
	);
}
