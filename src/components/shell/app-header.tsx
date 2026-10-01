import { UserMenu, type UserMenuProps } from "@/components/shell/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Sticky top bar inside `SidebarInset`: sidebar toggle, optional context (children, e.g.
 * the company name) and the account menu. Must be rendered inside a `SidebarProvider`.
 */
export function AppHeader({ user, children }: { user: UserMenuProps; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <UserMenu {...user} />
    </header>
  );
}
