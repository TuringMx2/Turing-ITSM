import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentInternalUser } from "@/lib/auth";
import { roleHome } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
	const user = await getCurrentInternalUser();
	if (user) {
		redirect(roleHome[user.role]);
	}

	return (
		<main className="page-shell auth-shell">
			<LoginForm />
		</main>
	);
}
