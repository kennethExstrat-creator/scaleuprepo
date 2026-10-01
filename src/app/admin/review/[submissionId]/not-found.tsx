import { FileQuestionIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Unknown, malformed or invisible monthly update id. */
export default function ReviewNotFound() {
  return (
    <EmptyState
      icon={FileQuestionIcon}
      title="Monthly update not found"
      description="This monthly update does not exist, or it has been removed. Open the month from the tracker instead."
      action={
        <Button asChild>
          <Link href="/admin/tracker">Go to the tracker</Link>
        </Button>
      }
      className="py-16"
    />
  );
}
