"use client";

import { DownloadIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { downloadFile } from "@/lib/exports/download";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

export type DownloadLinkProps = {
  /** The export route (null while the form is incomplete: the button is disabled). */
  href: string | null;
  /** Used when the response has no file name. */
  fallbackFilename: string;
  /** The button label (default "Download"). */
  children?: React.ReactNode;
  pendingText?: string;
  /** Toast shown when the file has been saved. */
  successMessage?: string;
  disabled?: boolean;
  /** Show errors under the button (default) or as a toast (e.g. in a page header). */
  inlineError?: boolean;
  /**
   * A file that can be cut short (e.g. the audit log CSV): when its last line begins with `marker`, a
   * warning (`title`, `description`) is shown instead of the success toast.
   */
  incomplete?: { marker: string; title: string; description: string };
  /**
   * Leave the download to the browser (for large files): it streams the file to disk with its own
   * progress instead of the file being held in memory first. A failure then shows the route's error page,
   * which links back here.
   */
  browserDownload?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Classes for the wrapper around the button and its error message. */
  wrapperClassName?: string;
};

/** How long the button stays busy after handing a download to the browser (it cannot tell when it starts). */
const BROWSER_DOWNLOAD_BUSY_MS = 8_000;

/**
 * A real link to an export route (works without JavaScript and with "open in new tab"), enhanced to
 * download in the background: a spinner while the file is prepared, the route's own message when it
 * fails (not a page of JSON), and a toast when it is saved. With `browserDownload` the browser downloads
 * it itself (large files).
 */
export function DownloadLink({
  href,
  fallbackFilename,
  children = "Download",
  pendingText = "Preparing…",
  successMessage = "Download ready",
  disabled = false,
  inlineError = true,
  incomplete,
  browserDownload = false,
  variant = "default",
  size = "default",
  className,
  wrapperClassName,
}: DownloadLinkProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const busyTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
    },
    [],
  );

  // A new choice clears the previous error.
  const [lastHref, setLastHref] = React.useState(href);
  if (href !== lastHref) {
    setLastHref(href);
    setError(null);
  }

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modified clicks (new tab / window) natively.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (browserDownload) {
      // The browser follows the link and saves the file itself; the button stays busy for a moment so
      // the download is not started twice while the server prepares it.
      if (pending || !href) {
        event.preventDefault();
        return;
      }
      setPending(true);
      setError(null);
      toast.info("Preparing your download", {
        description: "Your browser shows the file when it starts downloading. Large files can take a minute.",
      });
      busyTimer.current = window.setTimeout(() => {
        busyTimer.current = null;
        setPending(false);
      }, BROWSER_DOWNLOAD_BUSY_MS);
      return;
    }
    event.preventDefault();
    if (pending || !href) return;
    setPending(true);
    setError(null);
    const result = await downloadFile(href, fallbackFilename, { incompleteMarker: incomplete?.marker });
    setPending(false);
    if (result.ok && result.incomplete && incomplete) {
      toast.warning(incomplete.title, { description: incomplete.description, duration: 15_000 });
    } else if (result.ok) {
      toast.success(successMessage, { description: result.filename });
    } else if (inlineError) {
      setError(result.error);
    } else {
      toast.error(result.error);
    }
  }

  const icon = pending ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" aria-hidden="true" />;

  return (
    <div className={cn("flex flex-col gap-2", wrapperClassName)}>
      {href && !disabled ? (
        <Button asChild variant={variant} size={size} className={className}>
          <a
            href={href}
            onClick={handleClick}
            aria-busy={pending || undefined}
            aria-disabled={pending || undefined}
            aria-describedby={error ? errorId : undefined}
            className={pending ? "pointer-events-none opacity-70" : undefined}
          >
            {icon}
            {pending ? pendingText : children}
          </a>
        </Button>
      ) : (
        <Button type="button" variant={variant} size={size} className={className} disabled>
          {icon}
          {children}
        </Button>
      )}
      {inlineError ? <FormError id={errorId} message={error} /> : null}
    </div>
  );
}
