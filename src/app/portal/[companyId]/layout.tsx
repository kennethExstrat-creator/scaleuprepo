import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ToneBadge } from "@/components/app/status-badge";
import { AppHeader } from "@/components/shell/app-header";
import { PortalSidebar } from "@/components/shell/portal-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireCompanyAccess } from "@/lib/auth/session";
import { COMPANY_ROLE_LABELS, COMPANY_STATUS_LABELS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { CompanyStatus } from "@/lib/types/enums";

type CompanyHeaderRow = { id: string; name: string; status: CompanyStatus };

/**
 * Company portal shell for one company. Layouts do not re-run on client-side navigation, so
 * every page below must still call `requireCompanyAccess(companyId, …)` itself (memoised).
 * Nothing ScaleUp-internal is shown here: the partner-in-charge is not shown on the company side
 * (BRD §6.3, B24).
 */
export default async function CompanyPortalLayout({ children, params }: LayoutProps<"/portal/[companyId]">) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);

  const supabase = await createClient();
  const { data: companyData, error } = await supabase
    .from("companies")
    .select("id, name, status")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the company: ${error.message}`);
  const company: CompanyHeaderRow | null = companyData;
  if (!company) notFound();

  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const companies = ctx.memberships.map((m) => ({ id: m.companyId, name: m.companyName, role: m.role }));

  return (
    <SidebarProvider defaultOpen={sidebarState !== "false"}>
      <PortalSidebar
        companyId={company.id}
        companyName={company.name}
        companyRole={ctx.companyRole}
        companies={companies}
      />
      <SidebarInset className="min-w-0">
        <AppHeader user={{ name: ctx.fullName, email: ctx.email, roleLabel: COMPANY_ROLE_LABELS[ctx.companyRole] }}>
          <span className="truncate text-sm font-medium">{company.name}</span>
          {company.status !== "active" ? (
            <ToneBadge tone="neutral" title="Read-only: no new months are opened">
              {COMPANY_STATUS_LABELS[company.status] ?? company.status}
            </ToneBadge>
          ) : null}
        </AppHeader>
        <div className="flex flex-1 flex-col p-4 md:p-6 lg:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
