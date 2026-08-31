export default function Loading() {
	return (
		<main aria-busy="true" className="page-shell content-shell" id="main-content">
			<section className="card access-denied-card">
				<p className="eyebrow">TuringMx</p>
				<h1>Cargando espacio de trabajo…</h1>
				<p aria-live="polite" className="muted" role="status">
					Preparando el módulo seleccionado.
				</p>
			</section>
		</main>
	);
}
