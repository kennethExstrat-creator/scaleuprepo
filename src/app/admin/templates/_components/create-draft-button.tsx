"use client";

import { FilePlus2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { createDraftAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Starts a draft of the template (a copy of its published version) and opens it in the editor. If a
 * draft already exists (someone else just created one), that draft opens instead.
 */
export function CreateDraftButton({
  templateId,
  label = "Create draft from current",
  variant = "default",
  size = "default",
}: {
  templateId: string;
  label?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createDraftAction({ templateId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft ready", { description: "Make your changes, then publish them when you are ready." });
      router.push(`/admin/templates/${result.data.versionId}`);
    });
  }

  return (
    <Button variant={variant} size={size} onClick={handleClick} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <Spinner data-icon="inline-start" /> : <FilePlus2Icon data-icon="inline-start" aria-hidden="true" />}
      {label}
    </Button>
  );
}
