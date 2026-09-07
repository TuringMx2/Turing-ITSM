import { isAdmin, type InternalRole } from "@/lib/rbac";
import { getDailyAdminWorkspace, getDailyMemberWorkspace } from "@/app/actions/daily-runs";
import { DailyExperience } from "./daily-experience";

export async function DailyWorkspace({ role }: { role: InternalRole }) {
  return isAdmin(role) ? <DailyAdminWorkspace role={role} /> : <DailyMemberWorkspace />;
}

async function DailyAdminWorkspace({ role }: { role: InternalRole }) {
  const result = await getDailyAdminWorkspace();
  if (!result.data) {
    return (
      <section className="card access-denied-card">
        <p className="eyebrow">Daily</p>
        <h1>Daily no está disponible</h1>
        <p className="muted">{result.error ?? "No se pudo cargar el espacio Daily."}</p>
      </section>
    );
  }

  return <DailyExperience data={result.data} role={role} />;
}

async function DailyMemberWorkspace() {
  const result = await getDailyMemberWorkspace();
  if (!result.data) {
    return (
      <section className="card access-denied-card">
        <p className="eyebrow">Daily</p>
        <h1>Daily no está disponible</h1>
        <p className="muted">{result.error ?? "No se pudo cargar el espacio Daily."}</p>
      </section>
    );
  }

  return <DailyExperience data={result.data} role="support_agent" />;
}
