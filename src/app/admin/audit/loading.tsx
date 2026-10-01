import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLogLoading() {
  return (
    <div role="status" aria-label="Loading the audit log" className="flex flex-col gap-4">
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-4 rounded-xl p-4 ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 xl:col-span-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-4 w-48" />
      <div className="flex flex-col gap-px overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 bg-card px-3 py-3">
            <Skeleton className="size-6" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-4 w-28 md:block" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="hidden h-4 flex-1 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
