import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS = 6;
const ROWS = 6;

/** Tracker skeleton: header, filters, the six summary cards and the grid. */
export default function TrackerLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading the submission tracker…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="ml-auto h-8 w-44" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-72" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-foreground/10">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-3 border-b p-3">
          <Skeleton className="h-8 w-36 shrink-0 sm:w-48" />
          {Array.from({ length: COLUMNS }, (_, index) => (
            <Skeleton key={index} className="hidden h-8 w-36 shrink-0 md:block" />
          ))}
        </div>
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="flex gap-3 border-b p-3 last:border-b-0">
            <div className="flex w-36 shrink-0 flex-col gap-1.5 sm:w-48">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            {Array.from({ length: COLUMNS }, (_, column) => (
              <Skeleton key={column} className="h-8 w-36 shrink-0" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
