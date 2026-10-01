import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of /admin/settings: the header and the setting cards. */
export default function SettingsLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading the settings…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      {[3, 2, 1].map((rows, card) => (
        <div key={card} className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
          <div className="flex flex-col gap-2 border-b pb-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_20rem] md:gap-8">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-lg" />
                <Skeleton className="h-3 w-3/4 max-w-md" />
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
