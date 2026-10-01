"use client";

import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Dialog frame of the section and field forms. While `pending` (a save in flight) it cannot be closed.
 * Its children mount on open and unmount on close, so every opening starts from a fresh form.
 */
export function EditorDialog({
  open,
  onOpenChange,
  pending,
  title,
  description,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  title: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn("max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg", className)}
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
