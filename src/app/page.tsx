import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";

/**
 * "/" sends everyone to their home (docs/ARCHITECTURE.md §4): ScaleUp → /admin/tracker;
 * company user with one company → /portal/<id>; several → /portal; none → /no-access.
 * (requireUser first routes to /login, /no-access, /mfa or /terms when needed.)
 */
export default async function HomePage() {
  const ctx = await requireUser();
  if (ctx.scaleupRole) redirect("/admin/tracker");
  if (ctx.memberships.length === 1) redirect(`/portal/${ctx.memberships[0].companyId}`);
  if (ctx.memberships.length > 1) redirect("/portal");
  redirect("/no-access");
}
