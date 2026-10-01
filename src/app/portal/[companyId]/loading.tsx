import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10", className)}>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full max-w-md" />
      ))}
    </div>
  );
}

/**
 * Company portal skeleton: a page header and content cards. It is the loading state of the company home
 * and of every portal page below it that has no loading.tsx of its own, so it stays generic.
 */
export default function CompanyPortalLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <CardSkeleton lines={3} />
          <div className="grid grid-cols-2 gap-4 rounded-xl p-4 ring-1 ring-foreground/10 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </div>
  );
}
