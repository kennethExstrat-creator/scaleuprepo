"use server";

// A Super Admin or Fund Admin sets a company's OWN revenue segments on the owner's behalf (BRD B30;
// docs/ARCHITECTURE.md §1 "Define the company's own revenue segments: On behalf (logged)", §2.4
// set_company_revenue_segments): e.g. before the owner's account exists, or to correct them for the owner.
// assertScaleUp(super_admin, fund_admin) → zod → the company must be active (canManageCompanySegments; BRD
// B21) → the database's list checks word for word (companySegmentListError) → the segments in use must still
// be those the editor was opened with → setCompanyRevenueSegments (audited by the database as on behalf) →
// revalidate every page that shows the segments. The owner's own action is
// src/app/portal/[companyId]/segments/actions.ts; both take the same input.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canManageCompanySegments } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { REVENUE_SEGMENTS_MAX } from "@/lib/constants";
import { getCompany, setCompanyRevenueSegments } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { companySegmentListError, normaliseSegmentName } from "@/lib/types/domain";

import type { SavedRevenueSegments, SaveRevenueSegmentsInput } from "@/app/portal/[companyId]/segments/actions";
import { loadCurrentCompanySegments } from "@/app/portal/[companyId]/segments/_lib/load-segments";
import { sameSegmentList, SEGMENTS_CHANGED_MESSAGE } from "@/app/portal/[companyId]/segments/_lib/segments-model";

const segmentSchema = z.strictObject({
  id: z.guid({ error: SEGMENTS_CHANGED_MESSAGE }).nullable().optional(),
  // The exact limits (80 characters after trimming, no line breaks) are checked below in the database's words.
  name: z
    .string({ error: "Each revenue segment needs a name." })
    .max(1_000, { error: "Revenue segment names can be at most 80 characters." }),
});

const saveSchema = z.strictObject({
  companyId: z.guid({ error: MESSAGES.notFound }),
  expected: z
    .array(
      z.strictObject({
        id: z.guid({ error: SEGMENTS_CHANGED_MESSAGE }),
        name: z.string({ error: SEGMENTS_CHANGED_MESSAGE }).max(1_000, { error: SEGMENTS_CHANGED_MESSAGE }),
      }),
      { error: SEGMENTS_CHANGED_MESSAGE },
    )
    .max(REVENUE_SEGMENTS_MAX, { error: SEGMENTS_CHANGED_MESSAGE }),
  segments: z
    .array(segmentSchema, { error: "Send the revenue segments as a list." })
    .max(REVENUE_SEGMENTS_MAX, { error: `A company can have at most ${REVENUE_SEGMENTS_MAX} revenue segments.` }),
});

function parseInput(input: unknown): z.infer<typeof saveSchema> {
  const result = saveSchema.safeParse(input);
  if (result.success) return result.data;
  throw new ActionError(result.error.issues[0]?.message ?? MESSAGES.invalid);
}

/** Every page that shows the company's own revenue segments, on both sides. */
function revalidateSegments(companyId: string): void {
  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath("/admin/companies/[companyId]/updates/[month]", "page");
  revalidatePath("/admin/review/[submissionId]", "page");
  revalidatePath(`/portal/${companyId}/segments`);
  revalidatePath(`/portal/${companyId}/updates`);
  revalidatePath("/portal/[companyId]/updates/[month]", "page");
  revalidatePath(`/portal/${companyId}`);
}

/**
 * Saves a company's own revenue segments on the owner's behalf: Super Admins and Fund Admins, active
 * companies only. Returns the segments in use afterwards. The database records the change as on behalf.
 */
export async function saveCompanySegmentsOnBehalfAction(
  input: SaveRevenueSegmentsInput,
): Promise<ActionResult<SavedRevenueSegments>> {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin"]);
    const { companyId, expected, segments } = parseInput(input);

    const sb = await createClient();
    const company = await getCompany(sb, companyId);
    if (!company) throw new ActionError(MESSAGES.notFound);
    if (!canManageCompanySegments(ctx, companyId, company.status)) {
      throw new ActionError(`${company.name} is no longer an active portfolio company, so its records are read-only.`);
    }

    const list = segments.map((segment) => {
      const name = normaliseSegmentName(segment.name);
      return segment.id ? { id: segment.id.toLowerCase(), name } : { name };
    });
    const problem = companySegmentListError(list);
    if (problem) throw new ActionError(problem);

    // The list replaces the segments the editor started from: refuse when they changed since (the owner,
    // or a colleague, saved in between), rather than retire or overwrite what was not seen.
    const live = await loadCurrentCompanySegments(sb, companyId);
    if (!sameSegmentList(expected, live)) throw new ActionError(SEGMENTS_CHANGED_MESSAGE);

    const saved = await setCompanyRevenueSegments(sb, companyId, list);

    revalidateSegments(companyId);
    return ok({ segments: saved.map((segment) => ({ id: segment.id, name: segment.name })) });
  } catch (e) {
    return toActionError(e);
  }
}
