import { Skeleton } from "@/components/ui/skeleton";

import { CompaniesListSkeleton } from "./_components/companies-list-skeleton";

/** Skeleton of the companies list while the page loads. */
export default function CompaniesLoading() {
  return (
    <div className="flex flex-col">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <CompaniesListSkeleton />
    </div>
  );
}
