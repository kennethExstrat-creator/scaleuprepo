import { Skeleton } from "@/components/ui/skeleton";

import { NewCompanyFormSkeleton } from "./_components/new-company-skeleton";

/** Skeleton of "Add company" while the page loads. */
export default function NewCompanyLoading() {
  return (
    <div className="flex flex-col">
      <div className="mb-6 space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <NewCompanyFormSkeleton />
    </div>
  );
}
