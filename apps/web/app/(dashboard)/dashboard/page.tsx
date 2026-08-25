import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MyCardsWidget } from "@/components/dashboard/MyCardsWidget";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="page-shell">
      <div className="module-page" style={{ display: "grid", gap: 24 }}>
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 style={{ margin: "4px 0 8px" }}>My cards</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 700 }}>
            Top 10 tasks assigned to you, ordered by priority (urgent → high → medium → low). Data is RLS-scoped: only tasks where you are the assignee.
          </p>
        </div>

        <MyCardsWidget />

        <p className="muted small-text" style={{ margin: 0 }}>
          Go to <a href="/projects" style={{ color: "#2563eb", fontWeight: 700 }}>My projects</a> or <a href="/admin/projects" style={{ color: "#2563eb", fontWeight: 700 }}>Admin projects</a> to open a board.
        </p>
      </div>
    </main>
  );
}
