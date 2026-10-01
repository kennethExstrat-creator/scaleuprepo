import { LayoutTemplateIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Unknown or discarded template version. */
export default function TemplateVersionNotFound() {
  return (
    <EmptyState
      icon={LayoutTemplateIcon}
      title="Template version not found"
      description="This template version doesn't exist or isn't available to you. It may have been a draft that was discarded."
      action={
        <Button asChild>
          <Link href="/admin/templates">Back to templates</Link>
        </Button>
      }
    />
  );
}
