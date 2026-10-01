import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder of a tab's content while it loads. */
export function TabSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3" aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <Card className="lg:col-span-2">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </CardContent>
      </Card>
    </div>
  );
}
