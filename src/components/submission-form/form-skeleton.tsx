import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder of a monthly form page while it loads (breadcrumbs, title, sticky bar and sections). */
export function SubmissionFormSkeleton() {
  return (
    <div className="flex w-full flex-col gap-6" aria-busy="true" aria-label="Loading the monthly update">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {[0, 1, 2].map((card) => (
          <div key={card} className="flex flex-col gap-5 rounded-xl p-4 ring-1 ring-foreground/10">
            <Skeleton className="h-5 w-40" />
            <div className="grid gap-5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((field) => (
                <div key={field} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-full max-w-xs" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder of the monthly updates list. */
export function UpdatesListSkeleton() {
  return (
    <div className="flex w-full flex-col gap-6" aria-busy="true" aria-label="Loading monthly updates">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4 py-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="hidden h-4 w-20 md:block" />
            <Skeleton className="ml-auto h-7 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
