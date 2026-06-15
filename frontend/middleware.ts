import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/dashboard", "/chat", "/settings", "/model-engines"];

const BACKEND_URL = process.env.BACKEND_URL!;

async function checkSetupStatus(): Promise<boolean | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/setup-status/`, {
      cache: "no-store",
    });
    if (!res.ok) return null; // Backend error — treat as down
    const data = await res.json();
    return data.is_setup_complete ?? null;
  } catch {
    return null; // Django is down
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get("access_token")?.value;
  const isAuthenticated = !!accessToken;

  // Always verify setup status from the source of truth (the DB) so an empty /
  // reset DB (no admin account) reliably forces onboarding. This used to be
  // cached in a `setup_complete` cookie, but the cookie went stale after a DB
  // reset and kept showing /login until a hard refresh cleared it. The check is
  // a cheap existence query and middleware only runs on page navigations.
  const isSetupComplete = await checkSetupStatus();

  // If Django is down, let request through
  if (isSetupComplete === null) {
    return NextResponse.next();
  }

  // --- Setup NOT complete: force onboarding ---
  if (!isSetupComplete) {
    // Allow the onboarding page; redirect everything else (incl. /login) to it.
    const response =
      pathname === "/onboarding"
        ? NextResponse.next()
        : NextResponse.redirect(new URL("/onboarding", request.url));
    // Clear any stale setup_complete cookie left over from a previous install.
    if (request.cookies.get("setup_complete")?.value) {
      response.cookies.set("setup_complete", "", { path: "/", maxAge: 0 });
    }
    return response;
  }

  // --- Setup IS complete ---
  // Root redirect
  if (pathname === "/") {
    return NextResponse.redirect(
      new URL(isAuthenticated ? "/dashboard" : "/login", request.url)
    );
  }

  // Setup complete: block onboarding regardless of auth status
  if (pathname === "/onboarding") {
    return NextResponse.redirect(new URL(isAuthenticated ? "/dashboard" : "/login", request.url));
  }

  // Not authenticated on protected route → login
  if (!isAuthenticated && protectedRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated on login page → dashboard
  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|static-pages|.*\\.png$|.*\\.ico$|.*\\.svg$).*)"],
};
