"use client";

import {
  CircleAlertIcon,
  FileTextIcon,
  FlagIcon,
  InfoIcon,
  CalendarClockIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/actions/result";
import { formatNumber, formatNumberInput, parseNumberInput } from "@/lib/format";
import { addMonths, type MonthKey } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { MonthSelect } from "@/app/admin/cycles/_components/month-select";

import { updateSettingsAction } from "../actions";
import {
  describeSettingsChanges,
  displayValue,
  REPORTING_START_FIRST_MONTH,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  SETTINGS_LABELS,
  SETTINGS_LIMITS,
  settingsSchema,
  type ChangeSeverity,
  type SettingsChange,
  type SettingsKey,
  type SettingsValues,
} from "../_lib/settings-model";

type NumericKey =
  | "dueDay"
  | "backfillGraceDays"
  | "escalationDays"
  | "revenueSwingPct"
  | "minRunwayMonths"
  | "ownerContributorLimit";

const NUMERIC_KEYS: NumericKey[] = [
  "dueDay",
  "backfillGraceDays",
  "escalationDays",
  "revenueSwingPct",
  "minRunwayMonths",
  "ownerContributorLimit",
];

/** What the inputs hold: numbers as typed text, the rest as values. */
type FormText = Record<NumericKey, string> & {
  defaultReportingStart: string;
  declarationText: string;
  termsVersion: string;
  requireMfa: boolean;
};

/** Settings that have a default to offer (the terms version names the terms in force instead). */
type DefaultKey = Exclude<SettingsKey, "termsVersion">;

type Errors = Partial<Record<SettingsKey, string>>;

function isNumericKey(key: SettingsKey): key is NumericKey {
  return (NUMERIC_KEYS as readonly string[]).includes(key);
}

function toText(values: SettingsValues): FormText {
  return {
    dueDay: String(values.dueDay),
    backfillGraceDays: String(values.backfillGraceDays),
    escalationDays: String(values.escalationDays),
    revenueSwingPct: formatNumberInput(values.revenueSwingPct, 2),
    minRunwayMonths: formatNumberInput(values.minRunwayMonths, 2),
    ownerContributorLimit: String(values.ownerContributorLimit),
    defaultReportingStart: values.defaultReportingStart,
    declarationText: values.declarationText,
    termsVersion: values.termsVersion,
    requireMfa: values.requireMfa,
  };
}

/** A typed number, or NaN when the text is not one (so the schema explains what to enter). */
function numberOf(text: string): number {
  return parseNumberInput(text) ?? Number.NaN;
}

/** The schema's input. */
function toCandidate(text: FormText) {
  return {
    dueDay: numberOf(text.dueDay),
    backfillGraceDays: numberOf(text.backfillGraceDays),
    escalationDays: numberOf(text.escalationDays),
    revenueSwingPct: numberOf(text.revenueSwingPct),
    minRunwayMonths: numberOf(text.minRunwayMonths),
    ownerContributorLimit: numberOf(text.ownerContributorLimit),
    defaultReportingStart: text.defaultReportingStart,
    declarationText: text.declarationText,
    termsVersion: text.termsVersion,
    requireMfa: text.requireMfa,
  };
}

function isSettingsKey(value: unknown): value is SettingsKey {
  return typeof value === "string" && (SETTINGS_KEYS as readonly string[]).includes(value);
}

/** True when the input differs from `values` (numbers compared as numbers, text trimmed). */
function inputDiffers(key: SettingsKey, text: FormText, values: SettingsValues): boolean {
  if (isNumericKey(key)) {
    const parsed = parseNumberInput(text[key]);
    return parsed === null || parsed !== values[key];
  }
  if (key === "requireMfa") return text.requireMfa !== values.requireMfa;
  return text[key].trim() !== values[key].trim();
}

const SEVERITY_STYLES: Record<ChangeSeverity, { icon: typeof InfoIcon; className: string }> = {
  info: { icon: InfoIcon, className: "text-muted-foreground" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  danger: { icon: ShieldAlertIcon, className: "text-destructive" },
};

// ---------------------------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof InfoIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">{children}</CardContent>
    </Card>
  );
}

function SettingRow({
  id,
  label,
  description,
  error,
  footer,
  children,
  stacked = false,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  error?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Label above a full-width control (long text). */
  stacked?: boolean;
}) {
  return (
    <div
      data-invalid={error ? true : undefined}
      className={cn(
        "grid gap-3 py-4 first:pt-0 last:pb-0",
        !stacked && "md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:gap-8",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div id={`${id}-description`} className="text-sm text-pretty text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
        {footer}
      </div>
    </div>
  );
}

function describedBy(id: string, error?: string): string {
  return error ? `${id}-description ${id}-error` : `${id}-description`;
}

function DefaultHint({
  settingKey,
  offer,
  onUse,
}: {
  settingKey: DefaultKey;
  /** The input differs from the default: offer to use it. */
  offer: boolean;
  onUse: () => void;
}) {
  const defaultText = displayValue(settingKey, SETTINGS_DEFAULTS);
  return (
    <p className="text-xs text-muted-foreground">
      Default: {defaultText}.
      {offer ? (
        <>
          {" "}
          <button
            type="button"
            onClick={onUse}
            className="font-medium text-foreground underline underline-offset-3 hover:text-primary"
          >
            Use the default
          </button>
        </>
      ) : null}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// The review dialog
// ---------------------------------------------------------------------------------------------

/** The confirmation listing each change and what it does (exported for tests). */
export function SettingsReviewDialog({
  open,
  onOpenChange,
  changes,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: SettingsChange[];
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const id = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const dangerous = changes.some((change) => change.severity === "danger");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setAcknowledged(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Save {changes.length === 1 ? "this change" : `these ${changes.length} changes`}?</DialogTitle>
          <DialogDescription>Check what each change does before saving. Every change is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {changes.map((change) => {
            const style = SEVERITY_STYLES[change.severity];
            const Icon = style.icon;
            return (
              <li
                key={change.key}
                className={cn(
                  "flex gap-3 rounded-lg border p-3",
                  change.severity === "warning" && "border-warning/30 bg-warning/5",
                  change.severity === "danger" && "border-destructive/30 bg-destructive/5",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", style.className)} aria-hidden="true" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm font-medium">{change.label}</p>
                  <p className="text-sm break-words">
                    <span className="text-muted-foreground line-through decoration-muted-foreground/50">{change.from}</span>
                    <span className="mx-1.5 text-muted-foreground" aria-hidden="true">
                      →
                    </span>
                    <span className="sr-only">changes to</span>
                    <span className="font-medium">{change.to}</span>
                  </p>
                  <p className="text-sm text-pretty text-muted-foreground">{change.effect}</p>
                </div>
              </li>
            );
          })}
        </ul>
        {dangerous ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${id}-ack`}
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              disabled={pending}
            />
            <Label htmlFor={`${id}-ack`} className="text-sm leading-snug font-normal">
              I understand that accounts will be protected by a password only until two-factor authentication is turned
              back on.
            </Label>
          </div>
        ) : null}
        <FormError message={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep editing
          </Button>
          <Button
            type="button"
            variant={dangerous ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending || (dangerous && !acknowledged)}
            aria-busy={pending || undefined}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save {changes.length === 1 ? "change" : "changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

/**
 * The platform settings form (Super Admin). Edits every setting, shows each one's default, and asks for a
 * review of what the changes do before saving them in one update. Mount it with `key={updatedAt}` so it
 * starts again from the saved values after a save.
 */
export function SettingsForm({
  initial,
  updatedAt,
  currentMonth,
}: {
  initial: SettingsValues;
  /** `platform_settings.updated_at` the values were loaded with (the save checks nobody changed them since). */
  updatedAt: string;
  /** The current month in Malaysia time, 'YYYY-MM' (examples in the change review). */
  currentMonth: MonthKey;
}) {
  const id = useId();
  const [text, setText] = useState<FormText>(() => toText(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // `session` remounts the review dialog for every review (its acknowledgement starts unticked).
  const [review, setReview] = useState<{
    session: number;
    open: boolean;
    values: SettingsValues | null;
    changes: SettingsChange[];
  }>({ session: 0, open: false, values: null, changes: [] });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fieldId = (key: SettingsKey) => `${id}-${key}`;
  const changedCount = SETTINGS_KEYS.filter((key) => inputDiffers(key, text, initial)).length;
  const dirty = changedCount > 0;

  function set<K extends keyof FormText>(key: K, value: FormText[K]) {
    setText((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
  }

  const defaults: SettingsValues = { ...SETTINGS_DEFAULTS, termsVersion: initial.termsVersion };

  function applyDefault(key: DefaultKey) {
    set(key, toText(defaults)[key]);
  }

  function differsFromDefault(key: DefaultKey): boolean {
    return inputDiffers(key, text, defaults);
  }

  function startReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = settingsSchema.safeParse(toCandidate(text));
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (isSettingsKey(key) && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError(MESSAGES.invalid);
      const first = SETTINGS_KEYS.find((key) => next[key]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    const changes = describeSettingsChanges(initial, parsed.data, currentMonth);
    if (changes.length === 0) {
      toast.info("There are no changes to save.");
      return;
    }
    setErrors({});
    setFormError(null);
    setSaveError(null);
    setReview((current) => ({ session: current.session + 1, open: true, values: parsed.data, changes }));
  }

  function save() {
    const values = review.values;
    if (!values) return;
    setSaveError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updateSettingsAction>>;
      try {
        result = await updateSettingsAction({ ...values, expectedUpdatedAt: updatedAt });
      } catch (e) {
        // A terms version change ends on /terms: let Next.js follow the redirect.
        unstable_rethrow(e);
        setSaveError(MESSAGES.network);
        return;
      }
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        const next: Errors = {};
        for (const [key, message] of Object.entries(fields)) if (isSettingsKey(key)) next[key] = message;
        if (Object.keys(next).length > 0) {
          setErrors(next);
          setFormError(result.error);
          setReview((current) => ({ ...current, open: false }));
          return;
        }
        setSaveError(result.error);
        return;
      }
      setReview((current) => ({ ...current, open: false }));
      if (result.data.changed) {
        toast.success("Settings saved", {
          description: review.changes.map((change) => change.label).join(", "),
        });
      } else {
        toast.info("There were no changes to save.");
      }
    });
  }

  function discard() {
    setText(toText(initial));
    setErrors({});
    setFormError(null);
  }

  const mfaOff = !text.requireMfa;
  const L = SETTINGS_LIMITS;

  return (
    <>
      <form onSubmit={startReview} noValidate className="flex flex-col gap-6" aria-describedby={formError ? `${id}-form-error` : undefined}>
        <FormError id={`${id}-form-error`} message={formError} />

        <Section
          icon={CalendarClockIcon}
          title="Reporting cycle"
          description="When monthly updates are due and when late ones escalate (BRD §6.1, B4, B19)."
        >
          <SettingRow
            id={fieldId("dueDay")}
            label={SETTINGS_LABELS.dueDay}
            error={errors.dueDay}
            description="Each month's numbers are due on this day of the following month. Applies to months that open after you save; months already open keep their due dates."
            footer={<DefaultHint settingKey="dueDay" offer={differsFromDefault("dueDay")} onUse={() => applyDefault("dueDay")} />}
          >
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>Day</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={fieldId("dueDay")}
                value={text.dueDay}
                onChange={(event) => set("dueDay", event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
                aria-invalid={errors.dueDay ? true : undefined}
                aria-describedby={describedBy(fieldId("dueDay"), errors.dueDay)}
                disabled={pending}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>of the following month</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </SettingRow>

          <SettingRow
            id={fieldId("backfillGraceDays")}
            label={SETTINGS_LABELS.backfillGraceDays}
            error={errors.backfillGraceDays}
            description="A month that opens after its normal due date (for example when a company starts reporting mid-year) is due this many days after it opens. A month sent back or reopened also gets at least this long to be resubmitted."
            footer={
              <DefaultHint
                settingKey="backfillGraceDays"
                offer={differsFromDefault("backfillGraceDays")}
                onUse={() => applyDefault("backfillGraceDays")}
              />
            }
          >
            <NumberInput
              id={fieldId("backfillGraceDays")}
              value={text.backfillGraceDays}
              onChange={(value) => set("backfillGraceDays", value)}
              suffix="days"
              error={errors.backfillGraceDays}
              disabled={pending}
            />
          </SettingRow>

          <SettingRow
            id={fieldId("escalationDays")}
            label={SETTINGS_LABELS.escalationDays}
            error={errors.escalationDays}
            description="Overdue months show as escalated on the tracker, for the partner-in-charge to follow up, once they are more than this many days late."
            footer={
              <DefaultHint
                settingKey="escalationDays"
                offer={differsFromDefault("escalationDays")}
                onUse={() => applyDefault("escalationDays")}
              />
            }
          >
            <NumberInput
              id={fieldId("escalationDays")}
              value={text.escalationDays}
              onChange={(value) => set("escalationDays", value)}
              suffix="days overdue"
              error={errors.escalationDays}
              disabled={pending}
            />
          </SettingRow>

          <SettingRow
            id={fieldId("defaultReportingStart")}
            label={SETTINGS_LABELS.defaultReportingStart}
            error={errors.defaultReportingStart}
            description="The first month companies can report on the platform (BRD B3). A company's reporting start month cannot be earlier; months before it come from the historical workbooks."
            footer={
              <DefaultHint
                settingKey="defaultReportingStart"
                offer={differsFromDefault("defaultReportingStart")}
                onUse={() => applyDefault("defaultReportingStart")}
              />
            }
          >
            <MonthSelect
              id={fieldId("defaultReportingStart")}
              value={text.defaultReportingStart}
              onValueChange={(value) => set("defaultReportingStart", value)}
              from={REPORTING_START_FIRST_MONTH}
              to={addMonths(currentMonth, 12)}
              invalid={Boolean(errors.defaultReportingStart)}
              describedBy={describedBy(fieldId("defaultReportingStart"), errors.defaultReportingStart)}
              disabled={pending}
            />
          </SettingRow>
        </Section>

        <Section
          icon={FlagIcon}
          title="Review flags"
          description="Automatic flags on the review page (BRD A7, B12). Companies never see these thresholds (B27)."
        >
          <SettingRow
            id={fieldId("revenueSwingPct")}
            label={SETTINGS_LABELS.revenueSwingPct}
            error={errors.revenueSwingPct}
            description="Flag a month when revenue changes by more than this from the month before. Above twice this, the flag is critical."
            footer={
              <DefaultHint
                settingKey="revenueSwingPct"
                offer={differsFromDefault("revenueSwingPct")}
                onUse={() => applyDefault("revenueSwingPct")}
              />
            }
          >
            <NumberInput
              id={fieldId("revenueSwingPct")}
              value={text.revenueSwingPct}
              onChange={(value) => set("revenueSwingPct", value)}
              suffix="%"
              decimal
              error={errors.revenueSwingPct}
              disabled={pending}
            />
          </SettingRow>
          <SettingRow
            id={fieldId("minRunwayMonths")}
            label={SETTINGS_LABELS.minRunwayMonths}
            error={errors.minRunwayMonths}
            description="Flag a month when runway (cash in bank divided by the monthly burn) is below this. Below 3 months, the flag is critical; 0 turns the flag off."
            footer={
              <DefaultHint
                settingKey="minRunwayMonths"
                offer={differsFromDefault("minRunwayMonths")}
                onUse={() => applyDefault("minRunwayMonths")}
              />
            }
          >
            <NumberInput
              id={fieldId("minRunwayMonths")}
              value={text.minRunwayMonths}
              onChange={(value) => set("minRunwayMonths", value)}
              suffix="months"
              decimal
              error={errors.minRunwayMonths}
              disabled={pending}
            />
          </SettingRow>
        </Section>

        <Section
          icon={UsersIcon}
          title="Company teams"
          description="What company owners can do on their team page (BRD C1, B29)."
        >
          <SettingRow
            id={fieldId("ownerContributorLimit")}
            label={SETTINGS_LABELS.ownerContributorLimit}
            error={errors.ownerContributorLimit}
            description={`The most active contributors a company owner can have, pending invitations included. ScaleUp can always add more. From 0 (only ScaleUp adds contributors) to ${L.ownerContributorLimit.max}.`}
            footer={
              <DefaultHint
                settingKey="ownerContributorLimit"
                offer={differsFromDefault("ownerContributorLimit")}
                onUse={() => applyDefault("ownerContributorLimit")}
              />
            }
          >
            <NumberInput
              id={fieldId("ownerContributorLimit")}
              value={text.ownerContributorLimit}
              onChange={(value) => set("ownerContributorLimit", value)}
              suffix="per company"
              error={errors.ownerContributorLimit}
              disabled={pending}
            />
          </SettingRow>
        </Section>

        <Section
          icon={FileTextIcon}
          title="Submission declaration"
          description="What a company owner confirms when submitting a month."
        >
          <SettingRow
            id={fieldId("declarationText")}
            label={SETTINGS_LABELS.declarationText}
            error={errors.declarationText}
            stacked
            description="Owners tick this before they submit. Each submission keeps the wording that was accepted, so changing it does not affect months already submitted."
            footer={
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <DefaultHint
                    settingKey="declarationText"
                    offer={differsFromDefault("declarationText")}
                    onUse={() => applyDefault("declarationText")}
                  />
                  <span
                    className={cn(
                      "text-xs tabular-nums text-muted-foreground",
                      text.declarationText.trim().length > L.declarationText.max && "text-destructive",
                    )}
                  >
                    {formatNumber(text.declarationText.trim().length)} / {formatNumber(L.declarationText.max)}
                  </span>
                </div>
                <div className="mt-1 rounded-lg border border-dashed bg-muted/30 p-3" aria-hidden="true">
                  <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Preview</p>
                  <div className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 size-4 shrink-0 rounded-[4px] border border-input bg-background" />
                    <span className="text-pretty">{text.declarationText.trim() || "…"}</span>
                  </div>
                </div>
              </>
            }
          >
            <Textarea
              id={fieldId("declarationText")}
              value={text.declarationText}
              onChange={(event) => set("declarationText", event.target.value)}
              rows={3}
              maxLength={L.declarationText.max + 200}
              aria-invalid={errors.declarationText ? true : undefined}
              aria-describedby={describedBy(fieldId("declarationText"), errors.declarationText)}
              disabled={pending}
            />
          </SettingRow>
        </Section>

        <Section
          icon={ShieldCheckIcon}
          title="Sign-in and terms of use"
          description="Security rules for everyone who signs in (BRD B11, B25)."
        >
          <SettingRow
            id={fieldId("requireMfa")}
            label="Require two-factor authentication"
            error={errors.requireMfa}
            description={
              initial.requireMfa
                ? "Everyone signs in with their password and a code from an authenticator app, and the database enforces it too (BRD B11). It can't be turned off: if someone has lost their authenticator app, reset their two-factor authentication on the Users page."
                : "Everyone signs in with their password and a code from an authenticator app. The database enforces it too."
            }
            footer={
              <>
                <DefaultHint
                  settingKey="requireMfa"
                  offer={differsFromDefault("requireMfa")}
                  onUse={() => applyDefault("requireMfa")}
                />
                {mfaOff ? (
                  <Alert variant="destructive" className="mt-1 border-destructive/30 bg-destructive/5">
                    <ShieldAlertIcon aria-hidden="true" />
                    <AlertTitle>Two-factor authentication is off</AlertTitle>
                    <AlertDescription>
                      Everyone, including ScaleUp staff who can see the whole portfolio, can sign in with a password
                      only. Turn it on and save: once on, it stays on for everyone (BRD B11).
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            }
          >
            <div className="flex items-center gap-3">
              <Switch
                id={fieldId("requireMfa")}
                checked={text.requireMfa}
                // BRD B11: it can be turned on (an older database may have it off) but never off.
                onCheckedChange={(checked) => {
                  if (checked || !initial.requireMfa) set("requireMfa", checked);
                }}
                aria-describedby={describedBy(fieldId("requireMfa"), errors.requireMfa)}
                disabled={pending || initial.requireMfa}
              />
              <span className={cn("text-sm font-medium", mfaOff && "text-destructive")}>
                {text.requireMfa ? "Required for everyone" : "Not required"}
              </span>
            </div>
          </SettingRow>

          <SettingRow
            id={fieldId("termsVersion")}
            label={SETTINGS_LABELS.termsVersion}
            error={errors.termsVersion}
            description="Change it when the terms of use change. Everyone, including you, then has to accept the terms again before they can see any data."
            footer={
              inputDiffers("termsVersion", text, initial) ? (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  Saving asks everyone to accept the terms again, starting with you.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Version in force: {initial.termsVersion}.</p>
              )
            }
          >
            <Input
              id={fieldId("termsVersion")}
              value={text.termsVersion}
              onChange={(event) => set("termsVersion", event.target.value)}
              maxLength={L.termsVersion.max}
              autoComplete="off"
              spellCheck={false}
              placeholder="2026-10"
              className="tabular-nums"
              aria-invalid={errors.termsVersion ? true : undefined}
              aria-describedby={describedBy(fieldId("termsVersion"), errors.termsVersion)}
              disabled={pending}
            />
          </SettingRow>
        </Section>

        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {dirty ? `${changedCount} unsaved ${changedCount === 1 ? "change" : "changes"}` : "No unsaved changes"}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={discard} disabled={!dirty || pending}>
                Discard changes
              </Button>
              <Button type="submit" disabled={!dirty || pending}>
                Review and save
              </Button>
            </div>
          </div>
        </div>
      </form>

      <SettingsReviewDialog
        key={review.session}
        open={review.open}
        onOpenChange={(open) => setReview((current) => ({ ...current, open }))}
        changes={review.changes}
        pending={pending}
        error={saveError}
        onConfirm={save}
      />
    </>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  suffix,
  decimal = false,
  error,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  decimal?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={decimal ? "decimal" : "numeric"}
        autoComplete="off"
        className="tabular-nums"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error)}
        disabled={disabled}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{suffix}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}
