"use client";

import { ChevronRightIcon, CpuIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditChange, AuditEntryView } from "@/lib/exports/audit";
import { cn } from "@/lib/utils";

const COLUMN_COUNT = 7;

/** Middle-truncates long ids for the table (the full id is in the title and the details). */
function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function Value({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground italic">empty</span>;
  if (value === "") return <span className="text-muted-foreground italic">blank</span>;
  return (
    <pre className="max-h-40 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">{value}</pre>
  );
}

const KIND_TEXT: Record<AuditEntryView["changeKind"], string> = {
  update: "Changed fields",
  insert: "New record",
  delete: "Removed record",
  event: "Details",
  none: "Details",
};

function ChangesTable({ entry }: { entry: AuditEntryView }) {
  if (entry.changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No field values were recorded for this entry.</p>;
  }
  const twoSided = entry.changeKind === "update";
  const valueOf = (change: AuditChange) => (entry.changeKind === "delete" ? change.before : change.after);
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {KIND_TEXT[entry.changeKind]} of entry {entry.id}
        </caption>
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Field
            </th>
            {twoSided ? (
              <>
                <th scope="col" className="px-3 py-2 font-medium">
                  Before
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  After
                </th>
              </>
            ) : (
              <th scope="col" className="px-3 py-2 font-medium">
                Value
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {entry.changes.map((change) => (
            <tr key={change.field} className="border-t align-top">
              <th scope="row" className="w-48 px-3 py-2 text-left font-mono text-xs font-normal break-all">
                {change.field}
              </th>
              {twoSided ? (
                <>
                  <td className="px-3 py-2">
                    <Value value={change.before} />
                  </td>
                  <td className="px-3 py-2">
                    <Value value={change.after} />
                  </td>
                </>
              ) : (
                <td className="px-3 py-2">
                  <Value value={valueOf(change)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The expanded part of an audit row: summary, identifiers and the changed fields (old → new). */
export function AuditEntryDetails({ entry, id }: { entry: AuditEntryView; id: string }) {
  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Entry", value: `#${entry.id}` },
    { label: "Time (Malaysia)", value: entry.timestamp },
    {
      label: "Actor",
      value: entry.system
        ? "System"
        : `${entry.actorEmail ?? "Unknown user"}${entry.actorRole ? ` (${entry.actorRole})` : ""}`,
    },
  ];
  if (entry.actorId) facts.push({ label: "Actor ID", value: <code className="font-mono text-xs">{entry.actorId}</code> });
  facts.push({ label: "Record", value: `${entry.entityLabel} (${entry.entity})` });
  if (entry.entityId) facts.push({ label: "Record ID", value: <code className="font-mono text-xs">{entry.entityId}</code> });
  if (entry.companyId) facts.push({ label: "Company ID", value: <code className="font-mono text-xs">{entry.companyId}</code> });
  return (
    <div id={id} className="flex flex-col gap-4 py-2">
      {entry.summary ? <p className="text-sm text-pretty whitespace-pre-wrap">{entry.summary}</p> : null}
      {entry.onBehalf ? (
        <p className="text-sm text-muted-foreground">
          Entered by ScaleUp on behalf of the company.
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
        {facts.map(({ label, value }) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{KIND_TEXT[entry.changeKind]}</h3>
        <ChangesTable entry={entry} />
      </div>
    </div>
  );
}

function AuditRow({ entry, open, onToggle }: { entry: AuditEntryView; open: boolean; onToggle: () => void }) {
  const detailsId = `audit-entry-${entry.id}`;
  return (
    <>
      <TableRow data-state={open ? "selected" : undefined} className="align-top">
        <TableCell className="w-10">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            aria-label={`${open ? "Hide" : "Show"} details of entry ${entry.id}`}
          >
            <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} aria-hidden="true" />
          </Button>
        </TableCell>
        <TableCell className="tabular-nums">
          <time dateTime={entry.occurredAt} title={`${entry.timestamp} (Malaysia time)`}>
            {entry.time}
          </time>
        </TableCell>
        <TableCell>
          {entry.system ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CpuIcon className="size-3.5" aria-hidden="true" />
              System
            </span>
          ) : (
            <div className="flex max-w-56 flex-col">
              <span className="truncate" title={entry.actorEmail ?? undefined}>
                {entry.actorEmail ?? "Unknown user"}
              </span>
              {entry.actorRole ? <span className="text-xs text-muted-foreground">{entry.actorRole}</span> : null}
            </div>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            <ToneBadge tone={entry.actionTone} title={entry.action}>
              {entry.actionLabel}
            </ToneBadge>
            {entry.onBehalf ? (
              <ToneBadge tone="warning" title="Entered by ScaleUp on behalf of the company">
                On behalf
              </ToneBadge>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span>{entry.entityLabel}</span>
            {entry.entityId ? (
              <span className="font-mono text-xs text-muted-foreground" title={entry.entityId}>
                {shortId(entry.entityId)}
              </span>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          {entry.companyId === null ? (
            <span className="text-muted-foreground">—</span>
          ) : entry.companyName ? (
            <Link href={`/admin/companies/${entry.companyId}`} className="hover:text-primary hover:underline">
              {entry.companyName}
            </Link>
          ) : (
            <span className="text-muted-foreground" title={entry.companyId}>
              Deleted company
            </span>
          )}
        </TableCell>
        <TableCell className="min-w-64 whitespace-normal">
          <p className="line-clamp-2 max-w-[32rem] text-pretty" title={entry.summary ?? undefined}>
            {entry.summary ?? <span className="text-muted-foreground">—</span>}
          </p>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
            <AuditEntryDetails entry={entry} id={detailsId} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** The audit log entries of one page, newest first; each row expands to its changed fields. */
export function AuditLogTable({ entries }: { entries: AuditEntryView[] }) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(() => new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Details</span>
            </TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Summary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} open={open.has(entry.id)} onToggle={() => toggle(entry.id)} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
