"use server";

// The company owner saves the company's own revenue segments (BRD B30; docs/ARCHITECTURE.md §1, §2.4
// set_company_revenue_segments, §6 "(B30) Company revenue segments page"): assertCompanyAccess(owner) →
// the company must be active (exited / written-off companies are read-only, BRD B21) → zod → the list
// checks the database makes, word for word (companySegmentListError) → the segments in use must still be
// those the editor was opened with (else "have changed since this page was opened") →
// setCompanyRevenueSegments (the RPC decides renames in place vs new series, retires removed segments and
// updates the months still open for changes) → revalidate the pages that show the segments.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canManageCompanySegments, membershipFor } from "@/lib/auth/permissions";
import { assertCompanyAccess } from "@/lib/auth/session";
import { REVENUE_SEGMENTS_MAX } from "@/lib/constants";
import { setCompanyRevenueSegments } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { companySegmentListError, normaliseSegmentName } from "@/lib/types/domain";

import { loadCurrentCompanySegments } from "./_lib/load-segments";
import { sameSegmentList, SEGMENTS_CHANGED_MESSAGE } from "./_lib/segments-model";

const segmentSchema = z.strictObject({
  id: z.guid({ error: SEGMENTS_CHANGED_MESSAGE }).nullable().optional(),
  // The exact limits (80 characters after trimming, no line breaks) are checked below with the database's
  // own wording; this only bounds the input.
  name: z
    .string({ error: "Each revenue segment needs a name." })
    .max(1_000, { error: "Revenue segment names can be at most 80 characters." }),
});

/** The segments the editor was opened with: anything malformed cannot match, so it reads as changed. */
const expectedSchema = z
  .array(
    z.strictObject({
      id: z.guid({ error: SEGMENTS_CHANGED_MESSAGE }),
      name: z.string({ error: SEGMENTS_CHANGED_MESSAGE }).max(1_000, { error: SEGMENTS_CHANGED_MESSAGE }),
    }),
    { error: SEGMENTS_CHANGED_MESSAGE },
  )
  .max(REVENUE_SEGMENTS_MAX, { error: SEGMENTS_CHANGED_MESSAGE });

const saveSchema = z.strictObject({
  companyId: z.guid({ error: MESSAGES.notFound }),
  expected: expectedSchema,
  segments: z
    .array(segmentSchema, { error: "Send the revenue segments as a list." })
    .max(REVENUE_SEGMENTS_MAX, { error: `A company can have at most ${REVENUE_SEGMENTS_MAX} revenue segments.` }),
});

export type SaveRevenueSegmentsInput = {
  companyId: string;
  /**
   * The company's segments in use when the editor was opened (its `current`, in order). The save is
   * refused with SEGMENTS_CHANGED_MESSAGE when the segments in use now differ in any id, name or position
   * (a second tab or another owner saved in between): the list below would otherwise retire segments the
   * owner never saw, clear their figures in months not yet submitted, or undo someone else's renames.
   */
  expected: { id: string; name: string }[];
  /** The COMPLETE list in display order: current segments by `id` (with their possibly new name), new ones by name. */
  segments: { id?: string | null; name: string }[];
};

export type SavedRevenueSegments = {
  /** The company's segments in use after the save, in order. */
  segments: { id: string; name: string }[];
};

/** The company id of the input before it is validated (for the access check). */
function companyIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null && "companyId" in input) {
    const value = (input as { companyId: unknown }).companyId;
    if (typeof value === "string") return value;
  }
  return "";
}

/** Parses the input; a refusal states its first problem (the editor shows one message, not field marks). */
function parseInput(input: unknown): z.infer<typeof saveSchema> {
  const result = saveSchema.safeParse(input);
  if (result.success) return result.data;
  throw new ActionError(result.error.issues[0]?.message ?? MESSAGES.invalid);
}

/** Every page that shows the company's revenue segments: this page, the monthly updates and home. */
function revalidateSegments(companyId: string): void {
  revalidatePath(`/portal/${companyId}/segments`);
  revalidatePath(`/portal/${companyId}/updates`);
  revalidatePath("/portal/[companyId]/updates/[month]", "page");
  revalidatePath(`/portal/${companyId}`);
  revalidatePath(`/admin/companies/${companyId}`);
}

/**
 * Saves the company's revenue segments: the owner of an active company only. Returns the segments in use
 * afterwards. The database's refusals reach the owner as they are (duplicate names, too many segments,
 * segments changed by someone else since the page was opened, a company that is no longer active).
 *
 * The check against `expected` runs just before the RPC, outside its lock: two saves within the same
 * instant can still pass it (the RPC then refuses ids that are no longer current, but not segments added
 * in between). Closing that gap needs the RPC to compare the ids itself under its advisory lock.
 */
export async function saveRevenueSegmentsAction(
  input: SaveRevenueSegmentsInput,
): Promise<ActionResult<SavedRevenueSegments>> {
  try {
    const ctx = await assertCompanyAccess(companyIdOf(input), ["owner"]);
    const { companyId, expected, segments } = parseInput(input);
    if (!canManageCompanySegments(ctx, companyId)) {
      const companyName = membershipFor(ctx, companyId)?.companyName ?? "This company";
      throw new ActionError(`${companyName} is no longer an active portfolio company, so its records are read-only.`);
    }

    const list = segments.map((segment) => {
      const name = normaliseSegmentName(segment.name);
      return segment.id ? { id: segment.id.toLowerCase(), name } : { name };
    });
    const problem = companySegmentListError(list);
    if (problem) throw new ActionError(problem);

    const sb = await createClient();
    // The list replaces the segments the editor started from. If they changed since (a segment added,
    // renamed, removed or moved elsewhere), saving would silently retire or overwrite those changes.
    const live = await loadCurrentCompanySegments(sb, companyId);
    if (!sameSegmentList(expected, live)) throw new ActionError(SEGMENTS_CHANGED_MESSAGE);

    const saved = await setCompanyRevenueSegments(sb, companyId, list);

    revalidateSegments(companyId);
    return ok({ segments: saved.map((segment) => ({ id: segment.id, name: segment.name })) });
  } catch (e) {
    return toActionError(e);
  }
}
