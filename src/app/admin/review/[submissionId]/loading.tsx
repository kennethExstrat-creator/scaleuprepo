import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of the review page while the month loads. */
export default function ReviewLoading() {
  return (
    <div className="@container flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the monthly update…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-56" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
      </div>

      <Card size="sm">
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start @7xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full max-w-md" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="hidden h-4 w-14 sm:block" />
                  <Skeleton className="hidden h-4 w-24 md:block" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
