import { redirect } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";

export default async function AdminProjectsPage() {
  const user = await getCurrentInternalUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.role)) redirect("/workspace/dashboard");
  redirect("/workspace/roles-permisos");
}
