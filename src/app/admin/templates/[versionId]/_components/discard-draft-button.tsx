"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { discardDraftAction } from "../../actions";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";

/** Deletes the draft (with a confirmation), then returns to the template list. */
export function DiscardDraftButton({ versionId, versionNo }: { versionId: string; versionNo: number }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        Discard draft
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={`Discard draft version ${versionNo}?`}
        description="All changes in this draft are deleted. The published version and the months already opened are not affected. This can't be undone."
        confirmLabel="Discard draft"
        onConfirm={async () => {
          const result = await discardDraftAction({ versionId });
          if (!result.ok) throw new Error(result.error);
          toast.success(`Draft version ${versionNo} discarded`);
          router.push("/admin/templates");
        }}
      />
    </>
  );
}
