import { Skeleton } from "@/components/ui/skeleton";

import { TabSkeleton } from "./_components/tab-skeleton";

/** Skeleton of the company page while it loads. */
export default function CompanyLoading() {
  return (
    <div className="flex flex-col">
      <div className="mb-4 space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-36 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden border-b pb-3">
        {[20, 36, 28, 12, 14, 18, 32].map((width, index) => (
          <Skeleton key={index} className="h-5 shrink-0" style={{ width: `${width * 4}px` }} />
        ))}
      </div>
      <div className="mt-6">
        <TabSkeleton />
      </div>
    </div>
  );
}
