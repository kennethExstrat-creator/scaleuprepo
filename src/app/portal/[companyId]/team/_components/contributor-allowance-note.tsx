import { UsersIcon } from "lucide-react";

import { allowanceText, type ContributorAllowance } from "./team-model";
import { cn } from "@/lib/utils";

/**
 * For owners (BRD B29): "3 of 4 contributors. 1 place left. …", highlighted with the reason when no
 * place is left (the "Invite contributor" button and "Reactivate" are then disabled).
 */
export function ContributorAllowanceNote({ id, allowance }: { id: string; allowance: ContributorAllowance }) {
  const { headline, detail } = allowanceText(allowance);
  const full = allowance.blockedReason !== null;
  return (
    <div
      id={id}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        full ? "border-warning/30 bg-warning/5" : "bg-card",
      )}
    >
      <UsersIcon
        className={cn("mt-0.5 size-4 shrink-0", full ? "text-warning" : "text-muted-foreground")}
        aria-hidden="true"
      />
      <p className="min-w-0 text-pretty">
        <span className="font-medium text-foreground tabular-nums">{headline}.</span>{" "}
        <span className={full ? "text-foreground" : "text-muted-foreground"}>{detail}</span>
      </p>
    </div>
  );
}
