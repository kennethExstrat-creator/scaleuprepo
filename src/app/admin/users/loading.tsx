import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for /admin/users while people, accounts and links load. */
export default function UsersLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading users">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-96 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <Skeleton className="h-10 w-full rounded-none" />
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-t px-3 py-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="hidden h-5 w-24 md:block" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="hidden h-5 w-20 lg:block" />
              <Skeleton className="size-7" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
