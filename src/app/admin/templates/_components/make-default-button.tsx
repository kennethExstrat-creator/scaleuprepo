"use client";

import { StarIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { setDefaultTemplateAction } from "../actions";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";

/** Makes a template with a published version the default one (the database switches the old default off). */
export function MakeDefaultButton({
  templateId,
  templateName,
  publishedVersionNo,
}: {
  templateId: string;
  templateName: string;
  publishedVersionNo: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <StarIcon data-icon="inline-start" aria-hidden="true" />
        Make default
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Make “${templateName}” the default template?`}
        description={`Months opened from now on will use its published version (version ${publishedVersionNo}). Months already opened keep the version they were opened with.`}
        confirmLabel="Make default"
        onConfirm={async () => {
          const result = await setDefaultTemplateAction({ templateId });
          if (!result.ok) throw new Error(result.error);
          toast.success(`“${templateName}” is now the default template.`);
        }}
      />
    </>
  );
}
