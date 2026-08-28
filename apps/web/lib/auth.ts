import { createClient } from "@/utils/supabase/server";
import type { InternalRole, Role } from "./rbac";
import { isInternalRole, isRole } from "./rbac";

export type AuthUser = {
  id: string;
  email?: string;
  name: string;
  role: Role | null;
};

export type InternalAuthUser = Omit<AuthUser, "role"> & { role: InternalRole };

const DISPLAY_NAME_FALLBACK = "Usuario";

export function limitDisplayNameWords(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

export function resolveDisplayName({
  email,
  metadataFullName,
  profileFullName,
  profileEmail,
}: {
  email?: string;
  metadataFullName?: string;
  profileFullName?: string | null;
  profileEmail?: string | null;
}): string {
  const normalizedEmails = new Set(
    [email, profileEmail]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase()),
  );
  const normalizedProfileName = profileFullName?.trim();

  if (
    normalizedProfileName &&
    !normalizedEmails.has(normalizedProfileName.toLowerCase())
  ) {
    return limitDisplayNameWords(normalizedProfileName) || DISPLAY_NAME_FALLBACK;
  }

  const normalizedMetadataName = metadataFullName?.trim();
  if (normalizedMetadataName) {
    return limitDisplayNameWords(normalizedMetadataName) || DISPLAY_NAME_FALLBACK;
  }

  const emailLocalPart = email?.trim().split("@", 1)[0];
  return emailLocalPart
    ? limitDisplayNameWords(emailLocalPart) || DISPLAY_NAME_FALLBACK
    : DISPLAY_NAME_FALLBACK;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "active") return null;

  const role = profile?.role && isRole(profile.role) ? (profile.role as Role) : null;
  const email = profile?.email ?? user.email ?? undefined;
  const metadataFullName = user.user_metadata.full_name;

  return {
    id: user.id,
    email,
    name: resolveDisplayName({
      email: user.email ?? profile?.email ?? undefined,
      metadataFullName: typeof metadataFullName === "string" ? metadataFullName : undefined,
      profileFullName: profile?.full_name,
      profileEmail: profile?.email,
    }),
    role,
  };
}

export async function getCurrentInternalUser(): Promise<InternalAuthUser | null> {
  const user = await getCurrentUser();
  return user && isInternalRole(user.role) ? { ...user, role: user.role } : null;
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireRole(allowed: readonly Role[]): Promise<AuthUser> {
  const user = await requireAuth();
  if (!user.role || !allowed.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  return requireRole(["admin", "superadmin"]);
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_memberships")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
