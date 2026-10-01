"use client";

import type { AuthError } from "@supabase/supabase-js";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CopyIcon, RotateCwIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";

type Stage =
  | { kind: "loading" }
  | { kind: "enrol"; factorId: string; qrCode: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "failed"; message: string };

const TOTP_ISSUER = "ScaleUp Reporting";

/**
 * TOTP two-factor authentication with the browser Supabase client.
 * - No verified factor: removes stale unverified factors, enrols a new one and shows its QR
 *   code (an SVG data URL) plus the secret for manual entry.
 * - Verified factor: asks for the current code (challenge + verify).
 * On success the session becomes aal2 and the user continues to `next`.
 */
export function MfaForm({ next, email }: { next: string; email: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against React Strict Mode running the effect twice (which would enrol twice).
  const preparedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (preparedAttempt.current === attempt) return;
    preparedAttempt.current = attempt;

    void (async () => {
      const supabase = createClient();
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) {
        setStage({ kind: "failed", message: authErrorMessage(factors.error, "load") });
        return;
      }

      const verified = factors.data.totp[0];
      if (verified) {
        setStage({ kind: "verify", factorId: verified.id });
        return;
      }

      // Unfinished enrolments (e.g. the page was closed before verifying) block a new one.
      for (const factor of factors.data.all) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator app ${new Date().toISOString()}`,
        issuer: TOTP_ISSUER,
      });
      if (enrolled.error) {
        setStage({ kind: "failed", message: authErrorMessage(enrolled.error, "enrol") });
        return;
      }
      setStage({
        kind: "enrol",
        factorId: enrolled.data.id,
        qrCode: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      });
    })();
  }, [attempt]);

  async function verify(value: string) {
    if (submitting || (stage.kind !== "enrol" && stage.kind !== "verify")) return;
    if (!/^\d{6}$/.test(value)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: stage.factorId,
      code: value,
    });
    if (verifyError) {
      setSubmitting(false);
      setCode("");
      if (verifyError.code === "mfa_factor_not_found") {
        // The factor was removed meanwhile (e.g. set-up restarted in another tab): start over.
        setStage({
          kind: "failed",
          message: "This set-up is no longer valid, for example because it was restarted in another tab. Select Try again.",
        });
        return;
      }
      setError(authErrorMessage(verifyError, "verify"));
      return;
    }
    // The session is now aal2 (cookies updated by the browser client). Keep the button
    // disabled while the server renders the next page.
    router.replace(next);
    router.refresh();
  }

  function retry() {
    setStage({ kind: "loading" });
    setError(null);
    setCode("");
    setAttempt((value) => value + 1);
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Setup key copied");
    } catch {
      toast.error("Couldn't copy. Select the key and copy it manually.");
    }
  }

  const codeInput =
    stage.kind === "enrol" || stage.kind === "verify" ? (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify(code);
        }}
      >
        <Field>
          <FieldLabel htmlFor="mfa-code">6-digit code</FieldLabel>
          <InputOTP
            id="mfa-code"
            maxLength={6}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (error) setError(null);
            }}
            onComplete={(value: string) => void verify(value)}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "mfa-code-hint mfa-error" : "mfa-code-hint"}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <FieldDescription id="mfa-code-hint">The code changes every 30 seconds.</FieldDescription>
        </Field>
        <FormError id="mfa-error" message={error} />
        <Button type="submit" className="w-full" disabled={submitting || code.length !== 6}>
          {submitting ? <Spinner data-icon="inline-start" /> : null}
          {stage.kind === "enrol" ? "Verify and turn on" : "Verify"}
        </Button>
      </form>
    ) : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheckIcon className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">
          <h1>{stage.kind === "enrol" ? "Set up two-factor authentication" : "Two-factor authentication"}</h1>
        </CardTitle>
        <CardDescription>
          {stage.kind === "enrol"
            ? "ScaleUp requires an authenticator app for every account. It protects confidential portfolio data even if your password is stolen."
            : stage.kind === "verify"
              ? "Enter the 6-digit code from your authenticator app."
              : `Signed in as ${email}.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {stage.kind === "loading" ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mx-auto size-44" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : null}

        {stage.kind === "failed" ? (
          <div className="flex flex-col gap-3">
            <FormError message={stage.message} />
            <Button variant="outline" onClick={retry}>
              <RotateCwIcon data-icon="inline-start" />
              Try again
            </Button>
          </div>
        ) : null}

        {stage.kind === "enrol" ? (
          <>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                Install an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or
                1Password.
              </li>
              <li>Scan this QR code with the app (or enter the setup key below).</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-4">
              {/* Supabase returns the QR code as an SVG data URL; next/image adds nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stage.qrCode} alt="QR code to add ScaleUp Reporting to your authenticator app" className="size-44" />
              <div className="flex w-full flex-col items-center gap-1 text-center">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <SmartphoneIcon className="size-3.5" />
                  Can&apos;t scan? Enter this setup key:
                </span>
                <div className="flex items-center gap-1">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-xs tracking-wider break-all select-all">
                    {formatSecret(stage.secret)}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copySecret(stage.secret)}
                    aria-label="Copy setup key"
                  >
                    <CopyIcon />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {codeInput}

        {stage.kind === "verify" ? (
          <p className="text-xs text-muted-foreground">
            Lost access to your authenticator app? Ask a ScaleUp administrator to reset two-factor authentication for{" "}
            {email}.
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="justify-center">
        <SignOutButton variant="ghost" size="sm" className="text-muted-foreground">
          Sign out
        </SignOutButton>
      </CardFooter>
    </Card>
  );
}

function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function authErrorMessage(error: AuthError, step: "load" | "enrol" | "verify"): string {
  const code = error.code ?? "";
  if (error.name === "AuthRetryableFetchError" || error.status === 0) {
    return "Couldn't reach the server. Please try again.";
  }
  if (code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "session_not_found" || code === "session_expired" || code === "bad_jwt" || error.status === 401) {
    return "Your session has expired. Sign out and sign in again.";
  }
  if (step === "verify") {
    if (code === "mfa_challenge_expired") return "That code has expired. Enter the current code.";
    if (code === "mfa_verification_failed" || code === "mfa_verification_rejected" || error.status === 422) {
      return "That code didn't work. Check that the time on your phone is set automatically, then try again.";
    }
    return "We couldn't verify that code. Please try again.";
  }
  if (code === "mfa_totp_enroll_not_enabled") {
    return "Authenticator apps aren't enabled for this project yet. Please contact ScaleUp.";
  }
  if (code === "too_many_enrolled_mfa_factors") {
    return "Your account has too many unfinished authenticator set-ups. Ask ScaleUp to reset two-factor authentication.";
  }
  if (code === "mfa_verified_factor_exists") {
    return "An authenticator app is already set up for your account. Select Try again to enter its code.";
  }
  return step === "load"
    ? "We couldn't check your two-factor authentication status. Please try again."
    : "We couldn't start authenticator set-up. Please try again.";
}
