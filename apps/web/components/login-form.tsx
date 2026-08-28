"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import {
	signIn,
	type LoginActionState,
} from "@/app/actions/auth";
import { AmbientField } from "@/components/landing/ambient-field";

const initialState: LoginActionState = { error: null };

export function LoginForm() {
	const [state, formAction, isPending] = useActionState(signIn, initialState);
	const emailRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (state.error) emailRef.current?.focus();
	}, [state.error]);

	return (
		<div className="login-scene">
			<AmbientField />
			<div className="login-layout">
				<section
					className="login-card glass-card"
					aria-labelledby="login-title"
				>
					<header className="login-brand">
						<Image
							alt="Logo de TuringMx"
							className="login-logo"
							height={72}
							priority
							src="/logo.png"
							width={72}
						/>
						<h1 id="login-title" translate="no">TuringMx</h1>
						<p>Plataforma de gestión de servicios</p>
					</header>

					<form action={formAction} aria-busy={isPending} className="form-stack">
						<label>
							<span>Correo electrónico</span>
							<input
								aria-describedby={state.error ? "login-error" : undefined}
								aria-invalid={state.error ? true : undefined}
								autoComplete="email"
								name="email"
								placeholder="nombre@empresa.com…"
								required
								ref={emailRef}
								spellCheck={false}
								type="email"
							/>
						</label>
						<label>
							<span>Contraseña</span>
							<input
								aria-describedby={state.error ? "login-error" : undefined}
								aria-invalid={state.error ? true : undefined}
								autoComplete="current-password"
								name="password"
								placeholder="••••••••"
								required
								type="password"
							/>
						</label>
						{state.error ? <p aria-live="polite" className="form-error" id="login-error" role="alert">{state.error}</p> : null}
						<button className="primary-button" disabled={isPending} type="submit">
							{isPending ? "Ingresando…" : "Ingresar"}
						</button>
						<p className="login-footnote">
							Acceso exclusivo para personal autorizado.
						</p>
						<Link className="auth-link" href="/register">
							Registrate
						</Link>
					</form>
				</section>

				<aside
					className="test-users-card glass-card"
					aria-label="Acceso seguro al espacio de trabajo"
				>
					<p className="eyebrow">Identidad y acceso</p>
					<h2>Espacio protegido</h2>
					<p className="muted">
						Usá tu cuenta asignada. La sesión y el rol se verifican antes de abrir el espacio de trabajo.
					</p>
				</aside>
			</div>
		</div>
	);
}
