import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { isEditableStatus } from "@/components/submission-form/presentation";
import { listEarlierDrafts, loadCommentCounts } from "@/components/submission-form/queries";
import { SubmissionForm } from "@/components/submission-form/submission-form";
import { canEnterData, canSubmit } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { getSubmissionBundleByMonth, isNotFoundError, type SubmissionBundle } from "@/lib/data";
import { monthLabelLong, parseMonthKey } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

type PageProps = { params: Promise<{ companyId: string; month: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { month } = await params;
  const key = parseMonthKey(month);
  return { title: key ? `${monthLabelLong(key)} update` : "Monthly update" };
}

/** A company's monthly update for one month (C3, C6): the form while it can be edited, else read-only. */
export default async function MonthlyUpdatePage({ params }: PageProps) {
  const { companyId, month } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const key = parseMonthKey(month);
  if (!key) notFound();
  if (key !== month) redirect(`/portal/${companyId}/updates/${key}`);

  const sb = await createClient();
  let bundle: SubmissionBundle | null;
  try {
    bundle = await getSubmissionBundleByMonth(sb, companyId, key);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }
  if (!bundle) notFound();

  const editable = isEditableStatus(bundle.submission.status) && canEnterData(ctx, companyId, bundle.company.status);
  const [commentCounts, earlierDrafts] = await Promise.all([
    loadCommentCounts(sb, bundle.submission.id),
    editable
      ? listEarlierDrafts(sb, companyId, key, bundle.company.reporting_start_month)
      : Promise.resolve<string[]>([]),
  ]);

  const monthName = monthLabelLong(key);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Monthly updates", href: `/portal/${companyId}/updates` }, { label: monthName }]}
        title={`${monthName} update`}
        description={
          editable
            ? "Numbers are required every month; the narrative is optional. Your changes save automatically."
            : `The figures ${bundle.company.name} reported for ${monthName}.`
        }
      />
      <SubmissionForm
        bundle={bundle}
        mode={editable ? "company" : "readonly"}
        canSubmit={canSubmit(ctx, companyId)}
        commentMode="company"
        commentCounts={commentCounts}
        earlierDrafts={earlierDrafts}
      />
    </div>
  );
}
