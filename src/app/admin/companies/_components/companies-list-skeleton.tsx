import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for the filters and table of the companies list while they load. */
export function CompaniesListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        Loading companies…
      </span>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-4 w-72 max-w-full" />
      <Card className="gap-0 py-0">
        {Array.from({ length: 9 }, (_, row) => (
          <div key={row} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="hidden h-5 w-28 rounded-full md:block" />
            <Skeleton className="hidden h-4 w-28 lg:block" />
          </div>
        ))}
      </Card>
    </div>
  );
}
