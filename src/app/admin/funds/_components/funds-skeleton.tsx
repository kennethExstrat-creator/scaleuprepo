import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows of the funds table. */
export function FundsTableSkeleton() {
  return (
    <Card className="gap-0 py-0" aria-busy="true">
      <span className="sr-only" role="status">
        Loading funds…
      </span>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="flex items-start gap-6 border-b px-4 py-4 last:border-0">
          <Skeleton className="h-4 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </Card>
  );
}
