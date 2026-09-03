import { isAdmin, type InternalRole } from "@/lib/rbac";
import { getDailyAdminWorkspace, getDailyMemberWorkspace } from "@/app/actions/daily-runs";
import { DailyExperience } from "./daily-experience";

export async function DailyWorkspace({ role, teamId }: { role: InternalRole; teamId?: string }) {
  return isAdmin(role) ? <DailyAdminWorkspace role={role} teamId={teamId} /> : <DailyMemberWorkspace teamId={teamId} />;
}

async function DailyAdminWorkspace({ role, teamId }: { role: InternalRole; teamId?: string }) {
  const result = await getDailyAdminWorkspace(teamId);
  if (!result.data) {
    return (
      <section className="card access-denied-card">
        <p className="eyebrow">Daily</p>
        <h1>Daily no está disponible</h1>
        <p className="muted">{result.error ?? "No se pudo cargar el espacio Daily."}</p>
      </section>
    );
  }

  return <DailyExperience data={result.data} key={result.data.taskWorkspace.localDate ?? "daily"} role={role} />;
}

async function DailyMemberWorkspace({ teamId }: { teamId?: string }) {
  const result = await getDailyMemberWorkspace(teamId);
  if (!result.data) {
    return (
      <section className="card access-denied-card">
        <p className="eyebrow">Daily</p>
        <h1>Daily no está disponible</h1>
        <p className="muted">{result.error ?? "No se pudo cargar el espacio Daily."}</p>
      </section>
    );
  }

  return <DailyExperience data={result.data} key={result.data.taskWorkspace.localDate ?? "daily"} role="support_agent" />;
}
