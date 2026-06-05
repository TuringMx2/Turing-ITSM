"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NeuralNetworkCanvas } from "@/components/neural-network-canvas";
import {
	getMockSession,
	getRoleHome,
	loginWithMockUser,
	testUsers,
} from "@/lib/mock-auth";
import { roleLabels } from "@/lib/rbac";

export function LoginForm() {
	const router = useRouter();
	const [email, setEmail] = useState("customer.user@test.com");
	const [password, setPassword] = useState("password123");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const session = getMockSession();
		if (session) {
			router.replace(getRoleHome(session.role));
		}
	}, [router]);

	function handleSubmit(event: { preventDefault: () => void }) {
		event.preventDefault();
		setError(null);

		const session = loginWithMockUser(email, password);
		if (!session) {
			setError("Credenciales inválidas. Usá alguno de los usuarios de prueba.");
			return;
		}

		router.replace(getRoleHome(session.role));
	}

	function fillTestUser(userEmail: string) {
		setEmail(userEmail);
		setPassword("password123");
		setError(null);
	}

	return (
		<div className="login-scene">
			<NeuralNetworkCanvas />
			<div className="login-layout">
				<section
					className="login-card glass-card"
					aria-labelledby="login-title"
				>
					<header className="login-brand">
						<Image
							alt="Turing ITSM Logo"
							className="login-logo"
							height={72}
							priority
							src="/logo.png"
							width={72}
						/>
						<h1 id="login-title">Turing ITSM</h1>
						<p>Service Management Portal</p>
					</header>

					<form className="form-stack" onSubmit={handleSubmit}>
						<label>
							<span>Email</span>
							<input
								autoComplete="email"
								onChange={(event) => setEmail(event.target.value)}
								placeholder="customer.user@test.com"
								required
								type="email"
								value={email}
							/>
						</label>
						<label>
							<span>Password</span>
							<input
								autoComplete="current-password"
								onChange={(event) => setPassword(event.target.value)}
								placeholder="••••••••"
								required
								type="password"
								value={password}
							/>
						</label>
						{error ? <p className="form-error">{error}</p> : null}
						<button className="primary-button" type="submit">
							Iniciar sesión
						</button>
						<p className="login-footnote">
							Acceso mock para validar RBAC. Supabase Auth reemplazará esta capa
							más adelante.
						</p>
					</form>
				</section>

				<aside
					className="test-users-card glass-card"
					aria-label="Usuarios de prueba"
				>
					<p className="eyebrow">Identity & Access</p>
					<h2>Usuarios de prueba</h2>
					<p className="muted">
						Todos usan password: <strong>password123</strong>
					</p>
					<div className="test-user-list">
						{testUsers.map((user) => (
							<button
								className="test-user-button"
								key={user.id}
								onClick={() => fillTestUser(user.email)}
								type="button"
							>
								<span>{roleLabels[user.role]}</span>
								<small>{user.email}</small>
							</button>
						))}
					</div>
				</aside>
			</div>
		</div>
	);
}
