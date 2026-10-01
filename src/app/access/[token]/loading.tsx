import { AuthShell } from "@/components/shell/auth-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while the access link is looked up. */
export default function AccessLinkLoading() {
  return (
    <AuthShell>
      <Card className="w-full max-w-sm" aria-busy="true" aria-label="Checking your link">
        <CardHeader className="gap-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    </AuthShell>
  );
}
