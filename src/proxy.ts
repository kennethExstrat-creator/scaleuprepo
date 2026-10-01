import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 proxy (formerly middleware): refreshes the Supabase session, redirects
 * signed-out visitors to /login and enforces the 30-minute idle timeout.
 * Authorisation (roles, MFA, terms, company access) is checked in pages and actions.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets:
     * - _next/static, _next/image (build output and image optimisation)
     * - favicon.ico, icon / apple-icon (app icons), /brand/* (logo files)
     * - any file with an image extension
     */
    "/((?!_next/static|_next/image|favicon\\.ico|(?:apple-)?icon(?:\\.\\w+)?$|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp)$).*)",
  ],
};
