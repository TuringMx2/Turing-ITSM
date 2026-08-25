import { createClient } from "@/utils/supabase/server";
import type { Role } from "./rbac";
import { isRole } from "./rbac";

export type AuthUser = {
  id: string;
  email?: string;
  role: Role | null;
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return null;

  // Try to resolve role from profiles; fallback to null (unauthenticated role resolution)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role && isRole(profile.role) ? (profile.role as Role) : null;

  return {
    id: user.id,
    email: user.email ?? undefined,
    role,
  };
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireRole(allowed: Role[]): Promise<AuthUser> {
  const user = await requireAuth();
  if (!user.role || !allowed.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  return requireRole(["admin"]);
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
