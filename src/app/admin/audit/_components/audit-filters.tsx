"use client";

import { FilterIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ENTITY_GROUPS,
  auditActionMeta,
  auditEntityLabel,
  auditQueryString,
  hasAuditFilters,
  type AuditFilters,
} from "@/lib/exports/audit";

const ANY = "all";

function orAny(value: string | undefined): string {
  return value ?? ANY;
}

function fromAny(value: string): string | undefined {
  return value === ANY ? undefined : value;
}

/**
 * Filters of /admin/audit (company, actor email, action, entity, date range). Applying navigates to the
 * filtered URL (page 1), so filtered views can be bookmarked and shared; the page re-mounts this form
 * (keyed by the query string) when the URL changes.
 */
export function AuditLogFilters({
  companies,
  filters,
  today,
}: {
  companies: { id: string; name: string }[];
  filters: AuditFilters;
  /** Today in Malaysia time ('YYYY-MM-DD'), the latest date offered. */
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [company, setCompany] = React.useState(orAny(filters.company));
  const [actor, setActor] = React.useState(filters.actor ?? "");
  const [action, setAction] = React.useState(orAny(filters.action));
  const [entity, setEntity] = React.useState(orAny(filters.entity));
  const [from, setFrom] = React.useState(filters.from ?? "");
  const [to, setTo] = React.useState(filters.to ?? "");
  const id = React.useId();
  const ids = {
    company: `${id}-company`,
    actor: `${id}-actor`,
    action: `${id}-action`,
    entity: `${id}-entity`,
    from: `${id}-from`,
    to: `${id}-to`,
  };

  const knownActions = AUDIT_ACTION_GROUPS.flatMap((group) => group.actions);
  const knownEntities = AUDIT_ENTITY_GROUPS.flatMap((group) => group.entities);
  const unknownCompany = filters.company && !companies.some((c) => c.id === filters.company) ? filters.company : null;
  const unknownAction = filters.action && !knownActions.includes(filters.action) ? filters.action : null;
  const unknownEntity = filters.entity && !knownEntities.includes(filters.entity) ? filters.entity : null;

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = auditQueryString({
      company: fromAny(company),
      actor: actor.trim() || undefined,
      action: fromAny(action),
      entity: fromAny(entity),
      from: from || undefined,
      to: to || undefined,
    });
    startTransition(() => router.push(query ? `/admin/audit?${query}` : "/admin/audit"));
  }

  return (
    <form
      onSubmit={apply}
      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      aria-label="Filter the audit log"
      role="search"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Field className="xl:col-span-2">
          <FieldLabel htmlFor={ids.company}>Company</FieldLabel>
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger id={ids.company} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ANY}>Any company</SelectItem>
              {unknownCompany ? <SelectItem value={unknownCompany}>Deleted company</SelectItem> : null}
              <SelectSeparator />
              {companies.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="xl:col-span-2">
          <FieldLabel htmlFor={ids.actor}>Actor email</FieldLabel>
          <Input
            id={ids.actor}
            type="search"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder="Any part of the email"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.from}>From</FieldLabel>
          <Input id={ids.from} type="date" max={to || today} value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.to}>To</FieldLabel>
          <Input id={ids.to} type="date" min={from || undefined} max={today} value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Field className="xl:col-span-2">
          <FieldLabel htmlFor={ids.action}>Action</FieldLabel>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id={ids.action} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ANY}>Any action</SelectItem>
              {unknownAction ? <SelectItem value={unknownAction}>{auditActionMeta(unknownAction).label}</SelectItem> : null}
              {AUDIT_ACTION_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.actions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {auditActionMeta(value).label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="xl:col-span-2">
          <FieldLabel htmlFor={ids.entity}>Record type</FieldLabel>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger id={ids.entity} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ANY}>Any record type</SelectItem>
              {unknownEntity ? <SelectItem value={unknownEntity}>{auditEntityLabel(unknownEntity)}</SelectItem> : null}
              {AUDIT_ENTITY_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.entities.map((value) => (
                    <SelectItem key={value} value={value}>
                      {auditEntityLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-2">
          <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="flex-1 sm:flex-none">
            {pending ? <Spinner data-icon="inline-start" /> : <FilterIcon data-icon="inline-start" aria-hidden="true" />}
            Apply filters
          </Button>
          {hasAuditFilters(filters) ? (
            <Button asChild variant="ghost">
              <Link href="/admin/audit">
                <XIcon data-icon="inline-start" aria-hidden="true" />
                Clear
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
