import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of /admin/cycles: header, the four summary tiles, the tabs and the months table. */
export default function CyclesLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading the reporting cycles…</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-44" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-foreground/10">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="flex items-center gap-4 border-b p-3 last:border-b-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="hidden h-4 w-36 md:block" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-10" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="hidden h-2 w-40 rounded-full xl:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
