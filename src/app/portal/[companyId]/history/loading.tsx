import { Skeleton } from "@/components/ui/skeleton";

/** History skeleton: header, status counts and the table. */
export default function HistoryLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading your history…</span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="ml-auto h-4 w-24" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="h-6 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
