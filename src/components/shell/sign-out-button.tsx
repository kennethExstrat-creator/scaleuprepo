import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Sign-out as a plain HTML form POST to /auth/signout (works without JavaScript; the
 * route handler ends the session and redirects to /login).
 */
export function SignOutButton({
  variant = "outline",
  size = "default",
  className,
  children = "Sign out",
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <form action="/auth/signout" method="post" className="contents">
      <Button type="submit" variant={variant} size={size} className={className}>
        <LogOutIcon data-icon="inline-start" />
        {children}
      </Button>
    </form>
  );
}
