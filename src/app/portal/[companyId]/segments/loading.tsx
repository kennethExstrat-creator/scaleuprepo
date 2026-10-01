import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for the revenue segments page while the segments load. */
export default function RevenueSegmentsLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      aria-busy="true"
      aria-label="Loading the revenue segments"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="mx-4 mb-4 rounded-lg border">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 border-t px-3 py-3 first:border-t-0">
              <Skeleton className="h-4 w-4" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-8 w-full max-w-md" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="size-7" />
              <Skeleton className="size-7" />
              <Skeleton className="size-7" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/50 p-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </div>
  );
}
