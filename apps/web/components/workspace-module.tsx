"use client";

import { useEffect, useState } from "react";
import { getMockSession, type MockSession } from "@/lib/mock-auth";
import { getModuleForRole } from "@/lib/rbac";
import { ModulePlaceholder } from "./module-placeholder";

type WorkspaceModuleProps = {
	moduleSlug: string;
};

export function WorkspaceModule({ moduleSlug }: WorkspaceModuleProps) {
	const [session, setSession] = useState<MockSession | null>(null);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setSession(getMockSession());
		}, 0);

		return () => window.clearTimeout(timer);
	}, []);

	if (!session) {
		return null;
	}

	const activeModule = getModuleForRole(session.role, moduleSlug);

	if (!activeModule) {
		return null;
	}

	return <ModulePlaceholder module={activeModule} role={session.role} />;
}
