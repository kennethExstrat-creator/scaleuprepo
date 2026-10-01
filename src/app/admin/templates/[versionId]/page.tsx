import { ArrowRightIcon, FilePenLineIcon, InfoIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CreateDraftButton } from "../_components/create-draft-button";
import { personName } from "../_lib/display";
import { loadVersionPage, type VersionPageData } from "../_lib/queries";
import { checkPublishReadiness, diffTemplateVersions, summariseMonths } from "../_lib/rules";
import { DiscardDraftButton } from "./_components/discard-draft-button";
import { EditorShell } from "./_components/editor-shell";
import { FormPreview } from "./_components/form-preview";
import { PublishButton } from "./_components/publish-button";
import { TemplateEditor } from "./_components/template-editor";
import { VersionStatusPanel } from "./_components/version-status-panel";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageTemplates } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { TEMPLATE_STATUS_META } from "@/lib/constants";
import { isNotFoundError } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ScaleupRole } from "@/lib/types/enums";

type VersionPageProps = { params: Promise<{ versionId: string }> };

const TEMPLATE_ROLES: readonly ScaleupRole[] = ["super_admin", "fund_admin"];

/** One load per request, shared by generateMetadata and the page; null for unknown versions. */
const getVersionPage = cache(async (versionId: string): Promise<VersionPageData | null> => {
  const sb = await createClient();
  try {
    return await loadVersionPage(sb, versionId);
  } catch (e) {
    if (isNotFoundError(e)) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: VersionPageProps): Promise<Metadata> {
  await requireScaleUp(TEMPLATE_ROLES);
  const { versionId } = await params;
  const data = await getVersionPage(versionId);
  if (!data) return { title: "Template version not found" };
  return { title: `${data.version.template.name}, version ${data.version.version_no}` };
}

/**
 * A template version (BRD A3): the editor for a draft, a read-only view of published and archived
 * versions, each with a live preview of the form. Super Admin and Fund Admin only.
 */
export default async function TemplateVersionPage({ params }: VersionPageProps) {
  const ctx = await requireScaleUp(TEMPLATE_ROLES);
  const { versionId } = await params;
  const data = await getVersionPage(versionId);
  if (!data) notFound();
  const { version, versions, base, lockedFields, latestOpenMonth, people } = data;

  const canManage = canManageTemplates(ctx);
  const isDraft = version.status === "draft";
  const editable = canManage && isDraft;
  const summary = versions.find((item) => item.id === version.id) ?? null;
  const draft = versions.find((item) => item.status === "draft") ?? null;
  const published = versions.find((item) => item.status === "published") ?? null;
  // A draft's base is the published version it replaces: renamed C4 sections are flagged against it.
  const issues = isDraft ? checkPublishReadiness(version, base) : [];
  const blockingCount = issues.filter((issue) => issue.level === "error").length;
  const changes = base ? diffTemplateVersions(base, version) : [];
  const months = summariseMonths(summary?.months ?? []);
  const statusMeta = TEMPLATE_STATUS_META[version.status];
  const baseOutline = base
    ? {
        sections: base.sections.map((section) => ({ key: section.key, title: section.title })),
        fields: base.sections.flatMap((section) => section.fields.map((field) => field.key)),
      }
    : null;

  let description: string;
  if (isDraft) {
    description = `Started ${formatDate(version.created_at)} by ${personName(people, version.created_by)}. Changes are saved as you make them and reach companies only once you publish.`;
  } else {
    const publishedText = `Published ${formatDate(version.published_at)} by ${personName(people, version.published_by)}.`;
    const usedText = months ? ` Used for ${months}.` : " No months have been opened with it yet.";
    description = `${publishedText}${usedText}`;
  }

  let actions: React.ReactNode = null;
  if (canManage) {
    if (isDraft) {
      actions = (
        <>
          <DiscardDraftButton versionId={version.id} versionNo={version.version_no} />
          <PublishButton
            versionId={version.id}
            versionNo={version.version_no}
            templateName={version.template.name}
            isDefault={version.template.is_default}
            blockingCount={blockingCount}
            changeCount={base ? changes.length : null}
            previousVersionNo={published?.versionNo ?? null}
            latestOpenMonth={latestOpenMonth}
          />
        </>
      );
    } else if (draft) {
      actions = (
        <Button asChild>
          <Link href={`/admin/templates/${draft.id}`}>
            <FilePenLineIcon data-icon="inline-start" aria-hidden="true" />
            Continue draft (version {draft.versionNo})
          </Link>
        </Button>
      );
    } else if (version.status === "published") {
      actions = <CreateDraftButton templateId={version.template_id} label="Create draft from this version" />;
    } else if (published) {
      actions = (
        <Button asChild variant="outline">
          <Link href={`/admin/templates/${published.id}`}>
            View current version
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      );
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Templates", href: "/admin/templates" },
          { label: `${version.template.name}, version ${version.version_no}` },
        ]}
        title={`${version.template.name}: version ${version.version_no}`}
        description={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ToneBadge tone={statusMeta.tone}>{statusMeta.label}</ToneBadge>
            <span>{description}</span>
          </div>
        }
        actions={actions}
      />

      <div className="flex flex-col gap-6">
        {!isDraft ? (
          <Alert role="note" className="border-info/25 bg-info/5">
            <InfoIcon className="text-info" aria-hidden="true" />
            <AlertDescription className="text-foreground">
              {version.status === "published"
                ? "This is the live version: months opened now use it. It can't be changed. To change the form, create a draft; it starts as a copy of this version."
                : "This version has been replaced by a later one and can't be changed. Months opened while it was current keep using it."}
            </AlertDescription>
          </Alert>
        ) : null}

        <VersionStatusPanel
          mode={isDraft ? "draft" : "history"}
          issues={issues}
          changes={changes}
          baseVersionNo={base?.version_no ?? null}
          versionNo={version.version_no}
          notes={version.notes}
        />

        <EditorShell
          structure={
            <TemplateEditor version={version} editable={editable} lockedFields={lockedFields} base={baseOutline} />
          }
          preview={
            <Card size="sm">
              <CardHeader className="border-b">
                <CardTitle>
                  <h2>Form preview</h2>
                </CardTitle>
                <CardDescription>
                  {isDraft
                    ? "How the monthly update will look once this draft is published. It updates with every change."
                    : "How the monthly update looks for months opened with this version."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormPreview sections={version.sections} />
              </CardContent>
            </Card>
          }
        />
      </div>
    </>
  );
}
