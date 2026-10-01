"use client";

import { RocketIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { publishVersionAction } from "../../actions";
import { plural } from "../../_lib/display";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/periods";

/**
 * Publishes the draft with release notes (required) after a confirmation that explains what happens:
 * months opened from now on use this version, months already opened keep theirs.
 */
export function PublishButton({
  versionId,
  versionNo,
  templateName,
  isDefault,
  blockingCount,
  changeCount,
  previousVersionNo,
  latestOpenMonth,
}: {
  versionId: string;
  versionNo: number;
  templateName: string;
  isDefault: boolean;
  /** Issues that must be fixed first (the button is disabled while there are any). */
  blockingCount: number;
  /** Changes compared with the published version (null when there is none). */
  changeCount: number | null;
  previousVersionNo: number | null;
  /** The latest reporting month opened so far ('YYYY-MM-DD'). */
  latestOpenMonth: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const alreadyOpened = latestOpenMonth
    ? `Months already opened (the latest is ${monthLabel(latestOpenMonth)}) keep the version they were opened with, so their forms and answers do not change.`
    : "Months already opened keep the version they were opened with.";
  const effect = isDefault
    ? `Months opened from now on will use version ${versionNo} of ${templateName}. ${alreadyOpened}`
    : `Version ${versionNo} becomes the current version of ${templateName}. This template is not the default, so no months open with it until it is made the default.`;
  const archive = previousVersionNo !== null ? ` Version ${previousVersionNo} will be archived.` : "";
  const changes =
    changeCount === null || previousVersionNo === null
      ? ""
      : changeCount === 0
        ? ` There are no changes compared with version ${previousVersionNo}.`
        : ` ${plural(changeCount, "change")} compared with version ${previousVersionNo}.`;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={blockingCount > 0} aria-describedby={blockingCount > 0 ? "publish-blocked" : undefined}>
        <RocketIcon data-icon="inline-start" aria-hidden="true" />
        Publish
      </Button>
      {blockingCount > 0 ? (
        <span id="publish-blocked" className="sr-only">
          Fix the {plural(blockingCount, "issue")} listed on this page before publishing.
        </span>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Publish version ${versionNo}?`}
        description={`${effect}${archive}${changes}`}
        confirmLabel="Publish"
        requireReason
        reasonLabel="Release notes"
        reasonPlaceholder="What changed in this version? For example: “Added a Unit economics section.”"
        onConfirm={async (notes) => {
          const result = await publishVersionAction({ versionId, notes: notes ?? "" });
          if (!result.ok) throw new Error(result.error);
          toast.success(`Version ${result.data.versionNo} published`, {
            description: isDefault ? "Months opened from now on use it." : undefined,
          });
          router.push("/admin/templates");
        }}
      />
    </>
  );
}
