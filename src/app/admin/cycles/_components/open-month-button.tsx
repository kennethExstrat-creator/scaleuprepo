"use client";

import { CalendarPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/actions/result";
import { formatDate } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";

import { openMonthEarlyAction } from "../actions";
import { joinNames, plural, type OpenEarlyPreview } from "../_lib/cycles-model";

/** Companies listed by name in the confirmation (more are counted). */
const NAMES_SHOWN = 6;

function companiesText(names: string[]): string {
  if (names.length === 0) return "No company reports this month yet, so no monthly updates are created.";
  const shown = names.length > NAMES_SHOWN ? [...names.slice(0, NAMES_SHOWN), `${names.length - NAMES_SHOWN} more`] : names;
  return `${plural(names.length, "company", "companies")} can start entering numbers straight away: ${joinNames(shown)}.`;
}

/**
 * "Open <current month> early" (open_period; Super Admin and Fund Admin): the month opens now instead of on
 * the 1st of the following month. Asks for confirmation first.
 */
export function OpenMonthButton({
  preview,
  templateLabel,
}: {
  preview: OpenEarlyPreview;
  /** The default template's published version, e.g. "Portfolio Update v1" (null when none is published). */
  templateLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const long = monthLabelLong(preview.month);

  async function confirm() {
    let result: Awaited<ReturnType<typeof openMonthEarlyAction>>;
    try {
      result = await openMonthEarlyAction({ month: preview.month });
    } catch {
      throw new Error(MESSAGES.network);
    }
    if (!result.ok) throw new Error(result.error);
    toast.success(`${monthLabelLong(result.data.month)} is open`, {
      description: `Due ${formatDate(preview.dueDate)}. It shows on the tracker and in the companies' portals.`,
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
        Open {monthLabel(preview.month)} early
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Open ${long} now?`}
        confirmLabel={`Open ${monthLabel(preview.month)}`}
        description={
          <>
            <span className="block">
              {long} would otherwise open on {formatDate(preview.opensOn)}. {companiesText(preview.companies)}
            </span>
            <span className="mt-2 block">
              It stays due on <strong className="font-medium text-foreground">{formatDate(preview.dueDate)}</strong>
              {templateLabel ? ` and uses ${templateLabel}` : ""}. Opening a month cannot be undone.
            </span>
          </>
        }
        onConfirm={confirm}
      />
    </>
  );
}
