import { AuthShell } from "@/components/shell/auth-shell";

/** Shared frame for /login, /forgot-password, /set-password, /mfa and /terms. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
