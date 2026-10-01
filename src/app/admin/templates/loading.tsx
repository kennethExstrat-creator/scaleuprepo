import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while the templates and their versions load. */
export default function TemplatesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading templates…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-8 w-44" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
