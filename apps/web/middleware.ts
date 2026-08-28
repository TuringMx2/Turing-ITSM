import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "./utils/supabase/middleware";
import { isAdmin, isInternalRole, isSuperAdmin } from "./lib/rbac";

const PUBLIC_PATHS = ["/login", "/register", "/_next", "/favicon", "/api"];
const PROTECTED_PATHS = ["/workspace", "/dashboard", "/daily", "/projects", "/admin"];

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_PATHS.some((path) => matchesRoute(pathname, path)) ||
    pathname.includes(".")
  );
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
  includeNext = false,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (includeNext) url.searchParams.set("next", request.nextUrl.pathname);

  const redirectResponse = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function middleware(request: NextRequest) {
  const { response: sessionResponse, supabase, userId } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return sessionResponse;
  }

  const isProtected = PROTECTED_PATHS.some((path) => matchesRoute(pathname, path));
  if (!isProtected) {
    return sessionResponse;
  }

  if (!supabase || !userId) {
    return redirectWithSession(request, sessionResponse, "/login", true);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile || profile.status !== "active" || !isInternalRole(profile.role)) {
    return redirectWithSession(request, sessionResponse, "/login");
  }

  if (
    (matchesRoute(pathname, "/admin") && !isSuperAdmin(profile.role)) ||
    (matchesRoute(pathname, "/workspace/roles-permisos") && !isAdmin(profile.role))
  ) {
    return redirectWithSession(request, sessionResponse, "/workspace/dashboard");
  }

  return sessionResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
