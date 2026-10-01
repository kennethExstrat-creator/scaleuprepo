"use client";

import {
  ChartPieIcon,
  FileTextIcon,
  FolderOpenIcon,
  HistoryIcon,
  HouseIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CompanySwitcher, type SwitcherCompany } from "@/components/shell/company-switcher";
import { Logo } from "@/components/shell/logo";
import { ACTIVE_NAV_CLASSES, isNavActive } from "@/components/shell/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { CompanyRole } from "@/lib/types/enums";

type PortalNavItem = { title: string; path: string; icon: LucideIcon; exact?: boolean; ownerOnly?: boolean };

const PORTAL_NAV: PortalNavItem[] = [
  { title: "Home", path: "", icon: HouseIcon, exact: true },
  { title: "Monthly updates", path: "/updates", icon: FileTextIcon },
  // The company's own revenue segments (BRD B30): owners edit them, contributors read them.
  { title: "Revenue segments", path: "/segments", icon: ChartPieIcon },
  { title: "Documents", path: "/documents", icon: FolderOpenIcon },
  { title: "Team", path: "/team", icon: UsersIcon, ownerOnly: true },
  { title: "History", path: "/history", icon: HistoryIcon },
];

/**
 * Company portal navigation: logo, company switcher (several companies) or the company
 * name, and section links (Team for owners only). The ScaleUp partner-in-charge is internal to
 * ScaleUp and never shown on the company side (BRD §6.3, B24).
 */
export function PortalSidebar({
  companyId,
  companyName,
  companyRole,
  companies,
}: {
  companyId: string;
  companyName: string;
  companyRole: CompanyRole;
  companies: SwitcherCompany[];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const base = `/portal/${companyId}`;
  const items = PORTAL_NAV.filter((item) => !item.ownerOnly || companyRole === "owner");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-3">
        <Link
          href={base}
          className="flex w-fit items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          aria-label={`${companyName} home`}
        >
          <Logo className="h-8" />
        </Link>
        {companies.length > 1 ? (
          <CompanySwitcher companies={companies} currentId={companyId} />
        ) : (
          <p className="truncate px-1 text-sm font-medium group-data-[collapsible=icon]:hidden" title={companyName}>
            {companyName}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const href = `${base}${item.path}`;
                const active = isNavActive(pathname, href, item.exact);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className={ACTIVE_NAV_CLASSES}
                    >
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          if (isMobile) setOpenMobile(false);
                        }}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
