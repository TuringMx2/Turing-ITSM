"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fullNameSchema } from "@turing-itsm/validation";
import { isInternalRole, roleHome } from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";

export type LoginActionState = {
	error: string | null;
};

export type RegistrationActionState = {
	error: string | null;
	field?: "fullName";
	message: string | null;
};

const GENERIC_LOGIN_ERROR =
	"Unable to sign in. Check your credentials and try again.";
const GENERIC_REGISTRATION_ERROR =
	"No pudimos completar el registro. Intentá nuevamente más tarde.";
const PASSWORD_MISMATCH_ERROR = "Las contraseñas no coinciden.";
const REGISTRATION_RATE_LIMIT_ERROR =
	"Demasiados intentos en poco tiempo. Esperá unos minutos y volvé a intentar; también revisá tu carpeta de spam.";
const REGISTRATION_EMAIL_EXISTS_ERROR =
	"Ya existe una cuenta con ese correo electrónico. Ingresá con tus datos o restablecé tu contraseña.";
const REGISTRATION_WEAK_PASSWORD_ERROR =
	"La contraseña debe tener al menos 8 caracteres.";
const REGISTRATION_INVALID_EMAIL_ERROR =
	"El correo electrónico ingresado no es válido.";
const INVALID_FULL_NAME_ERROR = "Ingresá un nombre de hasta 160 caracteres.";
const REGISTRATION_CONFIRMATION_MESSAGE =
	"Cuenta creada. Revisá tu correo y confirmá la dirección para activar el acceso.";

export async function signIn(
	_previousState: LoginActionState,
	formData: FormData,
): Promise<LoginActionState> {
	const email = formData.get("email");
	const password = formData.get("password");

	if (
		typeof email !== "string" ||
		typeof password !== "string" ||
		!email.trim() ||
		!password ||
		email.length > 254 ||
		password.length > 1024
	) {
		return { error: GENERIC_LOGIN_ERROR };
	}

	let destination: string;

	try {
		const supabase = await createClient();
		const { data: authData, error: authError } =
			await supabase.auth.signInWithPassword({
				email: email.trim(),
				password,
			});

		if (authError || !authData.user) {
			return { error: GENERIC_LOGIN_ERROR };
		}

		const { data: profile, error: profileError } = await supabase
			.from("profiles")
			.select("role, status")
			.eq("id", authData.user.id)
			.maybeSingle();

		if (profileError || !profile || profile.status !== "active" || !isInternalRole(profile.role)) {
			await supabase.auth.signOut();
			return { error: GENERIC_LOGIN_ERROR };
		}

		destination = roleHome[profile.role];
	} catch {
		return { error: GENERIC_LOGIN_ERROR };
	}

	redirect(destination);
}

function mapRegistrationError(error: {
	message?: string;
	code?: string;
	status?: number;
} | null): string {
	const message = error?.message?.toLowerCase() ?? "";
	const code = error?.code?.toLowerCase() ?? "";
	const status = error?.status;

	if (
		status === 429 ||
		message.includes("rate limit") ||
		message.includes("over_email_send_rate_limit") ||
		message.includes("too many") ||
		code.includes("over_email_send_rate_limit")
	) {
		return REGISTRATION_RATE_LIMIT_ERROR;
	}
	if (
		message.includes("already been registered") ||
		message.includes("already registered") ||
		message.includes("exists") ||
		code === "email_exists"
	) {
		return REGISTRATION_EMAIL_EXISTS_ERROR;
	}
	if (message.includes("weak password") || message.includes("at least 6")) {
		return REGISTRATION_WEAK_PASSWORD_ERROR;
	}
	if (
		message.includes("invalid email") ||
		message.includes("email not allowed") ||
		message.includes("invalid_claim")
	) {
		return REGISTRATION_INVALID_EMAIL_ERROR;
	}
	return GENERIC_REGISTRATION_ERROR;
}

export async function signUp(
	_previousState: RegistrationActionState,
	formData: FormData,
): Promise<RegistrationActionState> {
	const fullName = formData.get("fullName");
	const email = formData.get("email");
	const password = formData.get("password");
	const passwordConfirmation = formData.get("passwordConfirmation");
	const fullNameResult = fullNameSchema.safeParse(fullName);

	if (!fullNameResult.success) {
		return {
			error: INVALID_FULL_NAME_ERROR,
			field: "fullName",
			message: null,
		};
	}

	if (
		typeof email !== "string" ||
		typeof password !== "string" ||
		typeof passwordConfirmation !== "string" ||
		!email.trim() ||
		!password ||
		!passwordConfirmation ||
		email.length > 254 ||
		password.length > 1024 ||
		passwordConfirmation.length > 1024
	) {
		return { error: GENERIC_REGISTRATION_ERROR, message: null };
	}

	if (password !== passwordConfirmation) {
		return { error: PASSWORD_MISMATCH_ERROR, message: null };
	}

	if (password.length < 8) {
		return { error: REGISTRATION_WEAK_PASSWORD_ERROR, message: null };
	}

	try {
		const supabase = await createClient();
		const { data: authData, error: authError } = await supabase.auth.signUp({
			email: email.trim(),
			password,
			options: {
				data: {
					full_name: fullNameResult.data,
				},
			},
		});

		if (authError || !authData.user) {
			return {
				error: authError ? mapRegistrationError(authError) : GENERIC_REGISTRATION_ERROR,
				message: null,
			};
		}

		if (!authData.session) {
			return { error: null, message: REGISTRATION_CONFIRMATION_MESSAGE };
		}

		const { data: profile, error: profileError } = await supabase
			.from("profiles")
			.select("role, status")
			.eq("id", authData.user.id)
			.maybeSingle();

		if (
			profileError ||
			!profile ||
			profile.role !== "support_agent" ||
			profile.status !== "active"
		) {
			await supabase.auth.signOut();
			return { error: GENERIC_REGISTRATION_ERROR, message: null };
		}

		revalidatePath("/", "layout");
	} catch {
		return { error: GENERIC_REGISTRATION_ERROR, message: null };
	}

	redirect(roleHome.support_agent);
}

export async function signOut(): Promise<void> {
	const supabase = await createClient();
	await supabase.auth.signOut();
	redirect("/login");
}
