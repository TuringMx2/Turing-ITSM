import { getModuleForRole, type InternalRole } from "@/lib/rbac";
import { ModulePlaceholder } from "./module-placeholder";

type WorkspaceModuleProps = {
	moduleSlug: string;
	role: InternalRole;
};

export function WorkspaceModule({ moduleSlug, role }: WorkspaceModuleProps) {
	const activeModule = getModuleForRole(role, moduleSlug);

	if (!activeModule) {
		return null;
	}

	return <ModulePlaceholder module={activeModule} role={role} />;
}
