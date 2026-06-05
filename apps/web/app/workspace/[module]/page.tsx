import { AppShell } from "@/components/app-shell";
import { WorkspaceModule } from "@/components/workspace-module";

type WorkspacePageProps = {
	params: Promise<{ module: string }>;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
	const { module } = await params;

	return (
		<AppShell moduleSlug={module}>
			<WorkspaceModule moduleSlug={module} />
		</AppShell>
	);
}
