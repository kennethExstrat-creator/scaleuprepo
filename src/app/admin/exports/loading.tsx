import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ fields }: { fields: number }) {
  return (
    <Card className="h-full">
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Skeleton className="h-8 w-40" />
      </CardFooter>
    </Card>
  );
}

export default function ExportsLoading() {
  return (
    <div role="status" aria-label="Loading exports">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <CardSkeleton fields={2} />
        <CardSkeleton fields={4} />
        <CardSkeleton fields={2} />
      </div>
    </div>
  );
}
