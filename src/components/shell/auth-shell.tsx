import { Logo } from "@/components/shell/logo";

/**
 * Centred, logo-topped frame for the sign-in flow (/login, /forgot-password,
 * /set-password, /mfa, /terms) and /no-access. The child card sets its own width.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/50">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
        <Logo className="h-14" priority />
        {children}
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        ScaleUp Malaysia · Portfolio Reporting · Confidential
      </footer>
    </div>
  );
}
