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

  // Use cookie as cache to avoid hitting the API on every single request.
  // Only call the API if cookie is missing (first visit or after factory reset).
  const setupCookie = request.cookies.get("setup_complete")?.value;
  let isSetupComplete: boolean | null;
  if (setupCookie === "true") {
    isSetupComplete = true;
  } else {
    isSetupComplete = await checkSetupStatus();
  }

  // If Django is down, let request through
  if (isSetupComplete === null) {
    return NextResponse.next();
  }

  // --- Setup NOT complete: force onboarding ---
  if (!isSetupComplete) {
    // Clear stale setup_complete cookie if it exists
    if (request.cookies.get("setup_complete")?.value === "true") {
      const response = pathname === "/onboarding"
        ? NextResponse.next()
        : NextResponse.redirect(new URL("/onboarding", request.url));
      response.cookies.set("setup_complete", "", { path: "/", maxAge: 0 });
      return response;
    }

    // Allow onboarding page
    if (pathname === "/onboarding") {
      return NextResponse.next();
    }

    // Redirect everything else to onboarding
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // --- Setup IS complete ---
  // Set cookie so future checks are faster (but we still verify via API)
  const response = NextResponse.next();
  if (request.cookies.get("setup_complete")?.value !== "true") {
    response.cookies.set("setup_complete", "true", {
      path: "/",
      maxAge: 365 * 24 * 3600,
    });
  }

  // Root redirect
  if (pathname === "/") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
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

  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|static-pages|.*\\.png$|.*\\.ico$|.*\\.svg$).*)"],
};
