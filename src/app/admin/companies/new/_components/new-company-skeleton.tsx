import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function FieldSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

/** Placeholder of the "Add company" form. */
export function NewCompanyFormSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the form…
      </span>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <FieldSkeleton wide />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton wide />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldSkeleton />
            <FieldSkeleton />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent>
            <FieldSkeleton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
