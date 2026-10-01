import { Skeleton } from "@/components/ui/skeleton";

/** Loading state of the documents pages: header, then close cards (or the portfolio table). */
export function DocumentsSkeleton({ variant = "company" }: { variant?: "company" | "portfolio" }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading documents…</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        {variant === "portfolio" ? <Skeleton className="h-8 w-56" /> : null}
      </div>

      {variant === "portfolio" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-4 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-7 w-28" />
              </div>
              {i === 0 ? (
                <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                  <Skeleton className="h-56 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
