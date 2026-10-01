import { Skeleton } from "@/components/ui/skeleton";

import { FundsTableSkeleton } from "./_components/funds-skeleton";

/** Skeleton of /admin/funds while it loads. */
export default function FundsLoading() {
  return (
    <div className="flex flex-col">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <FundsTableSkeleton />
    </div>
  );
}
