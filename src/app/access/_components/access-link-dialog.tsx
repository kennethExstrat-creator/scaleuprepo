"use client";

import { CheckIcon, CopyIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ACCESS_LINK_VALIDITY_LABELS } from "@/lib/auth-admin/purpose";
import type { InviteOutcome } from "@/lib/auth-admin/types";
import { formatDateTime } from "@/lib/format";

/**
 * Shows a link that was just issued (BRD B14: v1 has no invitation emails, so the issuer copies the link
 * and sends it by email or chat), or — when no link was needed — why. Open while `outcome` is set.
 * The link is never stored, so this is the only time it can be shown.
 */
export function AccessLinkDialog({
  outcome,
  onClose,
}: {
  outcome: InviteOutcome | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={outcome !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        {outcome ? <OutcomeBody key={`${outcome.userId}:${outcome.link?.expiresAt ?? "none"}`} outcome={outcome} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeBody({ outcome }: { outcome: InviteOutcome }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const { link, name, email, notice } = outcome;

  if (!link) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>No invitation link needed</DialogTitle>
          <DialogDescription>{notice ?? `${name} can sign in as usual.`}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }

  const isInvite = link.purpose === "invite";

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied", { description: `Paste it into an email or chat to ${name}.` });
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.error("Couldn't copy automatically", {
        description: "The link is selected: press Ctrl+C (or ⌘C on a Mac) to copy it.",
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isInvite ? `Invitation link for ${name}` : `Sign-in link for ${name}`}</DialogTitle>
        <DialogDescription>
          Send it to <span className="font-medium text-foreground">{email}</span> by email or chat. It works once and
          expires on <span className="font-medium whitespace-nowrap text-foreground">{formatDateTime(link.expiresAt)}</span>{" "}
          ({ACCESS_LINK_VALIDITY_LABELS[link.purpose]}).
        </DialogDescription>
      </DialogHeader>

      {notice ? (
        <Alert className="border-info/25 bg-info/5">
          <InfoIcon className="text-info" aria-hidden="true" />
          <AlertDescription className="text-foreground">{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={inputId}>{isInvite ? "Invitation link" : "Sign-in link"}</Label>
        <InputGroup>
          <InputGroupInput
            id={inputId}
            ref={inputRef}
            value={link.url}
            readOnly
            spellCheck={false}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="xs" variant="secondary" onClick={copyLink} aria-label="Copy link">
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <Alert className="border-warning/30 bg-warning/5">
        <TriangleAlertIcon className="text-warning" aria-hidden="true" />
        <AlertDescription className="text-foreground">
          Copy it now: for security the link isn&apos;t stored, so it can&apos;t be shown again. Anyone who has it can
          sign in as {name}, so send it only to them.{" "}
          {isInvite
            ? "They'll choose a password and set up two-factor authentication."
            : "They'll confirm with their authenticator app and choose a new password."}
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" onClick={copyLink}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
