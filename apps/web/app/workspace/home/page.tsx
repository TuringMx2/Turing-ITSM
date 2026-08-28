import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkspaceLanding } from "@/components/landing/workspace-landing";
import { getCurrentInternalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage() {
	const user = await getCurrentInternalUser();
	if (!user) redirect("/login");

	return (
		<AppShell moduleSlug="home" user={user}>
			<WorkspaceLanding displayName={user.name} />
		</AppShell>
	);
}
