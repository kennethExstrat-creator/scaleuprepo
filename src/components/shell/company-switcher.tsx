"use client";

import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import type { CompanyRole } from "@/lib/types/enums";

export type SwitcherCompany = { id: string; name: string; role: CompanyRole };

/** Portal sections that exist for every company (Team is owner-only). */
const SHARED_SECTIONS = new Set(["updates", "documents", "history"]);

/**
 * Company picker for founders with several companies. Keeps the current section when it
 * exists for the target company (e.g. Documents → Documents), otherwise opens its home.
 */
export function CompanySwitcher({ companies, currentId }: { companies: SwitcherCompany[]; currentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const current = companies.find((company) => company.id === currentId) ?? companies[0];

  function switchTo(company: SwitcherCompany) {
    if (company.id === currentId) return;
    const section = pathname.split("/")[3];
    const keepSection =
      section && (SHARED_SECTIONS.has(section) || (section === "team" && company.role === "owner"));
    if (isMobile) setOpenMobile(false);
    router.push(`/portal/${company.id}${keepSection ? `/${section}` : ""}`);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border border-sidebar-border data-open:bg-sidebar-accent"
              tooltip={current?.name}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2Icon />
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{current?.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {current ? COMPANY_ROLE_LABELS[current.role] : ""}
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side={isMobile ? "bottom" : "right"} className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Your companies</DropdownMenuLabel>
            {companies.map((company) => (
              <DropdownMenuItem key={company.id} onSelect={() => switchTo(company)}>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate">{company.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{COMPANY_ROLE_LABELS[company.role]}</span>
                </span>
                {company.id === currentId ? <CheckIcon className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
