import { cookies } from "next/headers";

import { AdminSidebar } from "@/components/shell/admin-sidebar";
import { AppHeader } from "@/components/shell/app-header";
import { IdleTimer } from "@/components/shell/idle-timer";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireScaleUp } from "@/lib/auth/session";
import { SCALEUP_ROLE_LABELS } from "@/lib/constants";

/**
 * ScaleUp admin shell. Layouts do not re-run on client-side navigation, so every admin page
 * must still call `requireScaleUp(...)` itself (it is memoised per request).
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireScaleUp();
  const sidebarState = (await cookies()).get("sidebar_state")?.value;

  return (
    <SidebarProvider defaultOpen={sidebarState !== "false"}>
      <AdminSidebar userId={ctx.userId} role={ctx.scaleupRole} />
      <SidebarInset className="min-w-0">
        <AppHeader
          user={{ name: ctx.fullName, email: ctx.email, roleLabel: SCALEUP_ROLE_LABELS[ctx.scaleupRole] }}
        />
        <div className="flex flex-1 flex-col p-4 md:p-6 lg:p-8">{children}</div>
      </SidebarInset>
      <IdleTimer />
    </SidebarProvider>
  );
}
