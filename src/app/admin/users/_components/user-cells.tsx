import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";

import type { DirectoryMembership, DirectoryUser } from "./directory-model";
import { ToneBadge } from "@/components/app/status-badge";
import { accountStatus, displayName } from "@/lib/auth-admin/status";
import { COMPANY_ROLE_LABELS, COMPANY_STATUS_LABELS } from "@/lib/constants";
import { EMPTY_DISPLAY, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// Presentational cells of the Users tables (no state).

/** Name (with a "You" tag), email and job title. */
export function PersonCell({ user }: { user: Pick<DirectoryUser, "fullName" | "email" | "jobTitle" | "isSelf"> }) {
  const name = displayName(user.fullName, user.email);
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 font-medium">
        <span className="truncate">{name}</span>
        {user.isSelf ? <ToneBadge tone="neutral">You</ToneBadge> : null}
      </span>
      {name !== user.email ? <span className="truncate text-xs text-muted-foreground">{user.email}</span> : null}
      {user.jobTitle ? <span className="truncate text-xs text-muted-foreground">{user.jobTitle}</span> : null}
    </div>
  );
}

/** Account status badge, with the pending invitation's expiry. */
export function AccountStatusCell({
  user,
}: {
  user: Pick<DirectoryUser, "isActive" | "hasSignedIn" | "pendingInvite">;
}) {
  const status = accountStatus({
    isActive: user.isActive,
    hasSignedIn: user.hasSignedIn,
    pendingInvite: user.pendingInvite !== null,
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <ToneBadge tone={status.tone} title={status.description}>
        {status.label}
      </ToneBadge>
      {status.key === "invited" && user.pendingInvite ? (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          Link expires {formatDate(user.pendingInvite.expiresAt)}
        </span>
      ) : null}
    </div>
  );
}

/** Whether a verified authenticator app is set up (two-factor authentication). */
export function MfaCell({ enrolled }: { enrolled: boolean | null }) {
  if (enrolled === null) return <span className="text-muted-foreground">{EMPTY_DISPLAY}</span>;
  return enrolled ? (
    <span className="inline-flex items-center gap-1 text-sm whitespace-nowrap text-success">
      <ShieldCheckIcon className="size-4" aria-hidden="true" />
      Set up
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm whitespace-nowrap text-muted-foreground">
      <ShieldAlertIcon className="size-4" aria-hidden="true" />
      Not set up
    </span>
  );
}

export function LastSignInCell({ at, hasSignedIn }: { at: string | null; hasSignedIn: boolean }) {
  if (at) return <span className="whitespace-nowrap tabular-nums">{formatDateTime(at)}</span>;
  return <span className="text-muted-foreground">{hasSignedIn ? EMPTY_DISPLAY : "Never"}</span>;
}

/** The person's companies: "Batik Boutique · Company Owner", greyed out when deactivated. */
export function MembershipList({ memberships }: { memberships: readonly DirectoryMembership[] }) {
  if (memberships.length === 0) return <span className="text-muted-foreground">No company yet</span>;
  return (
    <ul className="flex flex-col gap-1">
      {memberships.map((membership) => (
        <li key={membership.companyId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          <Link
            href={`/admin/companies/${membership.companyId}`}
            className={cn(
              "font-medium underline-offset-4 hover:underline",
              !membership.isActive && "text-muted-foreground line-through decoration-muted-foreground/60",
            )}
          >
            {membership.companyName}
          </Link>
          <span className="text-muted-foreground">· {COMPANY_ROLE_LABELS[membership.role]}</span>
          {!membership.isActive ? <ToneBadge tone="neutral">Deactivated</ToneBadge> : null}
          {membership.companyStatus !== "active" ? (
            <ToneBadge tone="neutral" title="Read-only: no new months are opened">
              {COMPANY_STATUS_LABELS[membership.companyStatus]}
            </ToneBadge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
