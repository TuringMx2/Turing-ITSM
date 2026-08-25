import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "./utils/supabase/middleware";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const PUBLIC_PATHS = ["/login", "/_next", "/favicon", "/api"];

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.includes(".")
  );
}

function isAdminRoute(pathname: string): boolean {
  return pathname.startsWith("/admin");
}

export async function middleware(request: NextRequest) {
  // Keep Supabase session refresh as base
  const sessionResponse = await updateSession(request);

  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return sessionResponse;
  }

  // If env not configured, skip auth checks (local dev without supabase)
  if (!supabaseUrl || !supabaseKey) {
    return sessionResponse;
  }

  // Auth check: create lightweight client from request cookies
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {},
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data?.user;

  const protectedPrefixes = ["/workspace", "/dashboard", "/daily", "/projects", "/admin"];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAdminRoute(pathname)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/workspace/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return sessionResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
