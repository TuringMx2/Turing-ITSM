"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { fullNameSchema, normalizeFullName } from "@turing-itsm/validation";
import {
	signUp,
	type RegistrationActionState,
} from "@/app/actions/auth";
import { AmbientField } from "@/components/landing/ambient-field";

const initialState: RegistrationActionState = { error: null, message: null };
const INVALID_FULL_NAME_ERROR = "Ingresá un nombre de hasta 160 caracteres.";

export function RegistrationForm() {
	const [state, formAction, isPending] = useActionState(signUp, initialState);
	const [fullNameError, setFullNameError] = useState<string | null>(null);
	const [dismissedFullNameErrorState, setDismissedFullNameErrorState] =
		useState<RegistrationActionState | null>(null);
	const fullNameRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const serverFullNameError =
		state.field === "fullName" && dismissedFullNameErrorState !== state
			? state.error
			: null;
	const resolvedFullNameError = fullNameError ?? serverFullNameError;
	const generalError = state.field === "fullName" ? null : state.error;

	useEffect(() => {
		if (!state.error) return;
		if (state.field === "fullName") {
			fullNameRef.current?.focus();
			return;
		}
		emailRef.current?.focus();
	}, [state.error, state.field]);

	function validateFullName(input: HTMLInputElement) {
		input.value = normalizeFullName(input.value);
		setFullNameError(
			fullNameSchema.safeParse(input.value).success ? null : INVALID_FULL_NAME_ERROR,
		);
	}

	function handleFullNameChange(input: HTMLInputElement) {
		setDismissedFullNameErrorState(state);
		setFullNameError(
			fullNameSchema.safeParse(input.value).success ? null : INVALID_FULL_NAME_ERROR,
		);
	}

	return (
		<div className="login-scene">
			<AmbientField />
			<div className="login-layout">
				<section
					aria-labelledby="registration-title"
					className="login-card glass-card"
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
						<h1 id="registration-title">Crear cuenta</h1>
						<p>Accedé al espacio de trabajo de TuringMx</p>
					</header>

					<form action={formAction} aria-busy={isPending} className="form-stack">
						<label>
							<span>Nombre(s)</span>
							<input
								aria-describedby={
									resolvedFullNameError ? "registration-full-name-error" : undefined
								}
								aria-invalid={resolvedFullNameError ? true : undefined}
								autoComplete="name"
								name="fullName"
								onBlur={(event) => validateFullName(event.currentTarget)}
								onChange={(event) => handleFullNameChange(event.currentTarget)}
								placeholder="Tu nombre completo"
								required
								ref={fullNameRef}
								type="text"
							/>
						</label>
						<label>
							<span>Correo electrónico</span>
							<input
								aria-describedby={generalError ? "registration-error" : undefined}
								aria-invalid={generalError ? true : undefined}
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
								aria-describedby={generalError ? "registration-error" : undefined}
								aria-invalid={generalError ? true : undefined}
								autoComplete="new-password"
								maxLength={1024}
								name="password"
								placeholder="••••••••"
								required
								type="password"
							/>
						</label>
						<label>
							<span>Repetir contraseña</span>
							<input
								aria-describedby={generalError ? "registration-error" : undefined}
								aria-invalid={generalError ? true : undefined}
								autoComplete="new-password"
								maxLength={1024}
								name="passwordConfirmation"
								placeholder="••••••••"
								required
								type="password"
							/>
						</label>
						{resolvedFullNameError ? (
							<p
								aria-live="polite"
								className="form-error"
								id="registration-full-name-error"
								role="alert"
							>
								{resolvedFullNameError}
							</p>
						) : null}
						{generalError ? (
							<p aria-live="polite" className="form-error" role="alert">
								<span id="registration-error">{generalError}</span>
							</p>
						) : null}
						{state.message ? (
							<p aria-live="polite" className="form-success" role="status">
								{state.message}
							</p>
						) : null}
						<button className="primary-button" disabled={isPending} type="submit">
							{isPending ? "Creando cuenta…" : "Registrate"}
						</button>
						<Link className="auth-link" href="/login">
							Volver a ingresar
						</Link>
					</form>
				</section>

				<aside
					aria-label="Información del registro"
					className="test-users-card glass-card"
				>
					<p className="eyebrow">Identidad y acceso</p>
					<h2>Acceso operativo</h2>
					<p className="muted">
						Tu cuenta se crea como integrante de soporte y queda vinculada al espacio de trabajo activo.
					</p>
				</aside>
			</div>
		</div>
	);
}
