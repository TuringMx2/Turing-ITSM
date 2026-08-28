"use client";

import { useFormStatus } from "react-dom";

export function SignOutSubmitButton() {
	const { pending } = useFormStatus();

	return (
		<button
			className="tmx-user-menu__sign-out"
			disabled={pending}
			type="submit"
		>
			<span aria-live="polite">
				{pending ? "Cerrando sesión…" : "Cerrar sesión"}
			</span>
		</button>
	);
}
