"use client";

// An error boundary for one section of a page (a tab, a list), so a failed load shows a friendly message
// with "Try again" in place of that section while the rest of the page keeps working. Built with Next's
// catchError, which lets redirect()/notFound() through and re-fetches the section on retry. Server
// errors reach the browser without details in production; they are logged on the server.

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { catchError, type ErrorInfo } from "next/error";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function LogError({ error }: { error: unknown }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return null;
}

function SectionErrorFallback({ title }: { title?: string }, { error, retry }: ErrorInfo) {
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{title ?? "This section couldn't be loaded"}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>Something went wrong while loading it. Please try again. If it keeps happening, reload the page.</span>
        <Button variant="outline" size="sm" onClick={() => retry()}>
          <RotateCwIcon data-icon="inline-start" />
          Try again
        </Button>
      </AlertDescription>
      <LogError error={error} />
    </Alert>
  );
}

export const SectionErrorBoundary = catchError(SectionErrorFallback);
