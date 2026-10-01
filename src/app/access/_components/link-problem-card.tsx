import { ClockAlertIcon, LinkIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { LINK_PROBLEM_COPY, type LinkProblem } from "./messages";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown on /access/[token] when the link cannot be used (expired, used, revoked, unknown) or could not
 * be checked (`retryHref` = the same page, for "Try again").
 */
export function LinkProblemCard({ problem, retryHref }: { problem: LinkProblem; retryHref?: string }) {
  const copy = LINK_PROBLEM_COPY[problem];
  const Icon = problem === "expired" ? ClockAlertIcon : problem === "unavailable" ? RefreshCwIcon : LinkIcon;
  const canRetry = problem === "unavailable" && Boolean(retryHref);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">
          <h1>{copy.title}</h1>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col gap-2">
        {canRetry && retryHref ? (
          <Button asChild className="w-full">
            <Link href={retryHref} prefetch={false}>
              Try again
            </Link>
          </Button>
        ) : null}
        <Button asChild variant={canRetry ? "ghost" : "default"} className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
