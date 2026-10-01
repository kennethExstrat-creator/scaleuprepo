"use client";

import {
  Building2Icon,
  CalendarClockIcon,
  DownloadIcon,
  FolderOpenIcon,
  LandmarkIcon,
  LayoutGridIcon,
  LayoutTemplateIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/shell/logo";
import { ACTIVE_NAV_CLASSES, isNavActive } from "@/components/shell/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  canManageCycles,
  canManagePlatform,
  canManageTemplates,
  canViewAudit,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import { SCALEUP_ROLE_LABELS } from "@/lib/constants";
import type { ScaleupRole } from "@/lib/types/enums";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  visible?: (subject: PermissionSubject) => boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Portfolio",
    items: [
      { title: "Tracker", href: "/admin/tracker", icon: LayoutGridIcon },
      { title: "Companies", href: "/admin/companies", icon: Building2Icon },
      // Every ScaleUp role may view funds (§1 "View: All"); only Super Admin manages them.
      { title: "Funds", href: "/admin/funds", icon: LandmarkIcon },
      { title: "Documents", href: "/admin/documents", icon: FolderOpenIcon },
    ],
  },
  {
    label: "Reporting",
    items: [{ title: "Exports", href: "/admin/exports", icon: DownloadIcon }],
  },
  {
    label: "Configuration",
    items: [
      { title: "Templates", href: "/admin/templates", icon: LayoutTemplateIcon, visible: canManageTemplates },
      { title: "Cycles", href: "/admin/cycles", icon: CalendarClockIcon, visible: canManageCycles },
      { title: "Users", href: "/admin/users", icon: UsersIcon, visible: canManagePlatform },
      { title: "Settings", href: "/admin/settings", icon: SettingsIcon, visible: canManagePlatform },
    ],
  },
  {
    label: "Governance",
    items: [{ title: "Audit log", href: "/admin/audit", icon: ScrollTextIcon, visible: canViewAudit }],
  },
];

/**
 * ScaleUp admin navigation. Items a role cannot use (docs/ARCHITECTURE.md §1) are hidden:
 * Users, Settings → Super Admin; Templates, Cycles → Super Admin + Fund Admin;
 * Audit log → everyone except Viewer. Tracker, Companies, Funds, Documents and Exports are
 * shown to every ScaleUp role (read-only where the role cannot manage them).
 */
export function AdminSidebar({ userId, role }: { userId: string; role: ScaleupRole }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const subject: PermissionSubject = { userId, scaleupRole: role, memberships: [] };

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.visible || item.visible(subject)),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3">
        <Link
          href="/admin/tracker"
          className="flex w-fit items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          aria-label="ScaleUp Portfolio Reporting home"
        >
          <Logo className="h-8" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={ACTIVE_NAV_CLASSES}
                      >
                        <Link
                          href={item.href}
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
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        Signed in as {SCALEUP_ROLE_LABELS[role]}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
