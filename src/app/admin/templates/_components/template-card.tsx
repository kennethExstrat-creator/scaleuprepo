import { ArrowRightIcon, FilePenLineIcon } from "lucide-react";
import Link from "next/link";

import { personName, plural } from "../_lib/display";
import type { TemplateOverview, VersionSummary } from "../_lib/queries";
import { summariseMonths } from "../_lib/rules";
import { CreateDraftButton } from "./create-draft-button";
import { MakeDefaultButton } from "./make-default-button";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TEMPLATE_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  overview: TemplateOverview;
  people: Record<string, string>;
  canManage: boolean;
  /** Offer "Make default" (only meaningful when there is more than one template). */
  showMakeDefault: boolean;
};

/** One template: its current version, draft and version history. */
export function TemplateCard({ overview, people, canManage, showMakeDefault }: Props) {
  const { template, versions, draft, published, draftChanges } = overview;
  const headingId = `template-${template.id}`;

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="font-heading text-base font-semibold">
                {template.name}
              </h2>
              {template.is_default ? (
                <ToneBadge tone="info" title="New reporting months open with this template's published version">
                  Default
                </ToneBadge>
              ) : null}
            </div>
            {template.description ? <CardDescription>{template.description}</CardDescription> : null}
          </div>
          {canManage ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {showMakeDefault && !template.is_default && published ? (
                <MakeDefaultButton
                  templateId={template.id}
                  templateName={template.name}
                  publishedVersionNo={published.versionNo}
                />
              ) : null}
              {draft ? (
                <Button asChild>
                  <Link href={`/admin/templates/${draft.id}`}>
                    <FilePenLineIcon data-icon="inline-start" aria-hidden="true" />
                    Continue draft
                  </Link>
                </Button>
              ) : (
                <CreateDraftButton
                  templateId={template.id}
                  label={published ? "Create draft from current" : "Create draft"}
                />
              )}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="space-y-1">
            <dt className="text-muted-foreground">Current version</dt>
            <dd className="font-medium">
              {published ? (
                <>
                  Version {published.versionNo}
                  <span className="block text-xs font-normal text-muted-foreground">
                    Published {formatDate(published.publishedAt)} by {personName(people, published.publishedBy)}
                  </span>
                </>
              ) : (
                "None published yet"
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Used for</dt>
            <dd className="font-medium">
              {published
                ? summariseMonths(published.months) || "No months opened yet"
                : "—"}
              {published ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {published.months.length > 0
                    ? `${plural(published.months.length, "reporting month")} opened with it`
                    : "Months opened from now on will use it"}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Draft</dt>
            <dd className="font-medium">
              {draft ? (
                <>
                  <Link
                    href={`/admin/templates/${draft.id}`}
                    className="underline-offset-4 hover:text-primary hover:underline"
                  >
                    Version {draft.versionNo}
                  </Link>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {draftChanges === null
                      ? `Started ${formatDate(draft.createdAt)} by ${personName(people, draft.createdBy)}`
                      : draftChanges.length === 0
                        ? "No changes yet"
                        : `${plural(draftChanges.length, "change")} not yet published`}
                  </span>
                </>
              ) : (
                <span className="font-normal text-muted-foreground">No draft in progress</span>
              )}
            </dd>
          </div>
        </dl>

        {versions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            This template has no versions yet. Create a draft to start building it.
          </p>
        ) : (
          <VersionsTable versions={versions} people={people} canManage={canManage} caption={`Versions of ${template.name}`} />
        )}
      </CardContent>
    </Card>
  );
}

function VersionsTable({
  versions,
  people,
  canManage,
  caption,
}: {
  versions: VersionSummary[];
  people: Record<string, string>;
  canManage: boolean;
  caption: string;
}) {
  return (
    <Table className="min-w-[46rem]">
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Months</TableHead>
          <TableHead className="text-right">Sections</TableHead>
          <TableHead className="text-right">Fields</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((version) => {
          const meta = TEMPLATE_STATUS_META[version.status];
          const isDraft = version.status === "draft";
          const href = `/admin/templates/${version.id}`;
          return (
            <TableRow key={version.id} className={cn(isDraft && "bg-warning/5")}>
              <TableCell className="font-medium">
                <Link href={href} className="underline-offset-4 hover:text-primary hover:underline">
                  Version {version.versionNo}
                </Link>
              </TableCell>
              <TableCell>
                <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
              </TableCell>
              <TableCell>
                {version.publishedAt ? (
                  <>
                    {formatDateTime(version.publishedAt)}
                    <span className="block text-xs text-muted-foreground">by {personName(people, version.publishedBy)}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Not published</span>
                    <span className="block text-xs text-muted-foreground">
                      Started {formatDate(version.createdAt)} by {personName(people, version.createdBy)}
                    </span>
                  </>
                )}
              </TableCell>
              <TableCell>
                {summariseMonths(version.months) || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{version.sectionCount}</TableCell>
              <TableCell className="text-right tabular-nums">{version.fieldCount}</TableCell>
              <TableCell className="max-w-72 whitespace-normal">
                {version.notes ? (
                  <span className="line-clamp-2 text-muted-foreground" title={version.notes}>
                    {version.notes}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link href={href} aria-label={`${isDraft && canManage ? "Edit" : "View"} version ${version.versionNo}`}>
                    {isDraft && canManage ? "Edit" : "View"}
                    <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
