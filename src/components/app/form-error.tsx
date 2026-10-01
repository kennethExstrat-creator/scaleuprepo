import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Form-level error message (renders nothing when `message` is empty). It is announced as an
 * alert; also give it an `id` and list that id in the related inputs' `aria-describedby` while
 * the error shows, so screen readers read it with the field.
 */
export function FormError({ message, id, className }: { message?: string | null; id?: string; className?: string }) {
  if (!message) return null;
  return (
    <Alert id={id} variant="destructive" className={cn("border-destructive/30 bg-destructive/5", className)}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}
