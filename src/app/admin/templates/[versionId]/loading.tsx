import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a template version loads. */
export default function TemplateVersionLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the template version…</span>
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-4 w-56" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
          <div className="hidden space-y-3 rounded-xl p-4 ring-1 ring-foreground/10 xl:block">
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
