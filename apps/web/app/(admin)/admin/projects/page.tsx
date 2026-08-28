import { redirect } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac";

export default async function AdminProjectsPage() {
  const user = await getCurrentInternalUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.role)) redirect("/workspace/dashboard");
  redirect("/workspace/roles-permisos");
}
