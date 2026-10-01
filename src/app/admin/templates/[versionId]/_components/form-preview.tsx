import { CalculatorIcon, ChevronDownIcon } from "lucide-react";

import { FIELD_TYPE_LABELS } from "@/lib/constants";
import { parseFieldOptions, type TemplateFieldRow, type TemplateSectionFull } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

// A static, read-only picture of the monthly form a template version produces (no inputs, nothing
// focusable): sections in template order, each field with its label, "required" marker, help text and
// a mock control for its type. Hook-free, so the server page renders it and the editor shows it next to
// the structure; it refreshes after every saved change.

const NUMBER_TYPES = new Set(["currency", "number", "integer", "percent"]);

export function FormPreview({ sections }: { sections: readonly TemplateSectionFull[] }) {
  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">This version has no sections yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <PreviewSection key={section.id} section={section} />
      ))}
    </div>
  );
}

function PreviewSection({ section }: { section: TemplateSectionFull }) {
  const titleId = `preview-section-${section.id}`;
  const optional =
    (section.kind === "narrative" || section.kind === "pulse" || section.kind === "custom_numbers") &&
    !section.fields.some((field) => field.is_required);
  return (
    <section aria-labelledby={titleId} className="rounded-lg border bg-background">
      <header className="flex flex-col gap-0.5 border-b bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="text-sm font-semibold">
            {section.title}
          </h3>
          {optional ? <span className="text-xs text-muted-foreground">Optional</span> : null}
        </div>
        {section.description ? <p className="text-xs text-muted-foreground">{section.description}</p> : null}
      </header>
      <div className="flex flex-col gap-3 p-3">
        {section.kind === "financials" ? (
          <p className="text-xs text-muted-foreground">
            Companies with revenue lines enter revenue per line first; the total must equal their sum.
          </p>
        ) : null}
        {section.fields.map((field) => (
          <PreviewField key={field.id} field={field} />
        ))}
        {section.kind === "financials" ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalculatorIcon className="size-3.5" aria-hidden="true" />
            Gross margin, net margin and runway are calculated as they type.
          </p>
        ) : null}
        {section.kind === "kpis" ? (
          <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            Each company&apos;s own KPIs appear here (for example revenue per outlet), as set up for the company.
          </p>
        ) : null}
        {section.fields.length === 0 && section.kind !== "kpis" ? (
          <p className="text-xs text-muted-foreground italic">No fields yet.</p>
        ) : null}
      </div>
    </section>
  );
}

function PreviewField({ field }: { field: TemplateFieldRow }) {
  const required = field.is_required || field.is_system;
  const inline = NUMBER_TYPES.has(field.field_type);
  const label = (
    <div className="flex items-baseline gap-1 text-sm font-medium">
      <span>{field.label}</span>
      {required ? (
        <>
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
      <span className="sr-only">, {FIELD_TYPE_LABELS[field.field_type].toLowerCase()} answer</span>
    </div>
  );
  const help = field.help_text ? <p className="text-xs text-muted-foreground">{field.help_text}</p> : null;

  if (inline) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-x-3 gap-y-1">
        <div className="min-w-0">
          {label}
          {help}
        </div>
        <MockControl field={field} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {help}
      <MockControl field={field} />
    </div>
  );
}

function MockBox({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MockControl({ field }: { field: TemplateFieldRow }) {
  const options = parseFieldOptions(field);
  switch (field.field_type) {
    case "currency":
      return (
        <MockBox className="justify-between tabular-nums">
          <span>RM</span>
          <span>0</span>
        </MockBox>
      );
    case "number":
    case "integer":
      return <MockBox className="justify-end tabular-nums">0</MockBox>;
    case "percent":
      return (
        <MockBox className="justify-end tabular-nums">
          <span>0</span>
          <span>%</span>
        </MockBox>
      );
    case "text":
      return <MockBox />;
    case "long_text":
      return <MockBox className="h-16" />;
    case "boolean":
      return (
        <div aria-hidden="true" className="flex gap-2">
          {["Yes", "No"].map((answer) => (
            <span key={answer} className="rounded-lg border px-3 py-1 text-sm text-muted-foreground">
              {answer}
            </span>
          ))}
        </div>
      );
    case "picklist":
      return (
        <div className="flex flex-col gap-1">
          <MockBox className="justify-between">
            <span>Choose…</span>
            <ChevronDownIcon className="size-4" />
          </MockBox>
          {options.choices.length > 0 ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">Options: {options.choices.join(" · ")}</p>
          ) : (
            <p className="text-xs text-destructive">No options yet.</p>
          )}
        </div>
      );
    case "tags":
      return options.choices.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.choices.map((choice, index) => (
            // The builder refuses repeated tags, but stored options are not checked: key by position too.
            <span key={`${index}-${choice}`} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {choice}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-destructive">No tags yet.</p>
      );
    case "rating": {
      const scale = options.rating ?? { min: 1, max: 5, labels: {} };
      const values: number[] = [];
      if (Number.isInteger(scale.min) && Number.isInteger(scale.max) && scale.max > scale.min && scale.max - scale.min <= 20) {
        for (let value = scale.min; value <= scale.max; value++) values.push(value);
      }
      const labels = Object.entries(scale.labels);
      return (
        <div className="flex flex-col gap-1">
          <div aria-hidden="true" className="flex flex-wrap gap-1">
            {values.map((value) => (
              <span
                key={value}
                className="flex size-8 items-center justify-center rounded-md border text-sm text-muted-foreground tabular-nums"
              >
                {value}
              </span>
            ))}
          </div>
          {labels.length > 0 ? (
            <p className="text-xs text-muted-foreground">{labels.map(([value, text]) => `${value} = ${text}`).join(" · ")}</p>
          ) : null}
        </div>
      );
    }
  }
}
