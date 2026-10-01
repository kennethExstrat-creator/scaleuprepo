import { redirect } from "next/navigation";

import { IdleTimer } from "@/components/shell/idle-timer";
import { requireUser } from "@/lib/auth/session";

/**
 * Company portal wrapper: signed-in company users only (ScaleUp staff use /admin). Mounts the
 * idle timer once for /portal and every /portal/[companyId]/… page. Each page must still call
 * `requireCompanyAccess(companyId)` (or `requireUser()`) itself.
 */
export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const ctx = await requireUser();
  if (ctx.scaleupRole) redirect("/admin");

  return (
    <>
      {children}
      <IdleTimer />
    </>
  );
}
